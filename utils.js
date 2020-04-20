const { utils } = require('@serverless/core')

const configureBucketForHosting = async (s3, bucketName) => {
  const s3BucketPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadGetObject',
        Effect: 'Allow',
        Principal: {
          AWS: '*'
        },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucketName}/*`]
      }
    ]
  }
  const staticHostParams = {
    Bucket: bucketName,
    WebsiteConfiguration: {
      ErrorDocument: {
        Key: 'index.html'
      },
      IndexDocument: {
        Suffix: 'index.html'
      }
    }
  }

  const putPostDeleteHeadRule = {
    AllowedMethods: ['PUT', 'POST', 'DELETE', 'HEAD'],
    AllowedOrigins: ['https://*.amazonaws.com'],
    AllowedHeaders: ['*'],
    MaxAgeSeconds: 0
  }
  const getRule = {
    AllowedMethods: ['GET'],
    AllowedOrigins: ['*'],
    AllowedHeaders: ['*'],
    MaxAgeSeconds: 0
  }

  try {
    await s3
      .putBucketPolicy({
        Bucket: bucketName,
        Policy: JSON.stringify(s3BucketPolicy)
      })
      .promise()

    await s3
      .putBucketCors({
        Bucket: bucketName,
        CORSConfiguration: {
          CORSRules: [putPostDeleteHeadRule, getRule]
        }
      })
      .promise()

    await s3.putBucketWebsite(staticHostParams).promise()
  } catch (e) {
    if (e.code === 'NoSuchBucket') {
      await utils.sleep(2000)
      return configureBucketForHosting(s3, bucketName)
    }
    throw e
  }
}

const configureSecurityHeadersInjectorLambda = async ({ lambda, cf, institution, domainName }) => {
  const { Versions } = await lambda
    .listVersionsByFunction({
      FunctionName: `${institution}-security-headers-injector-prod-injectSecurityHeaders`
    })
    .promise()

  const latestPublishedVersion = Versions.pop()

  const { DistributionList } = await cf.listDistributions().promise()

  const { Id: distributionId } = DistributionList.Items.find(({ Aliases: { Items } }) => {
    return Items.find((alias) => alias === domainName)
  })
  const { DistributionConfig, ETag } = await cf
    .getDistributionConfig({ Id: distributionId })
    .promise()

  const newDistroConfig = {
    ...DistributionConfig,
    DefaultCacheBehavior: {
      ...DistributionConfig.DefaultCacheBehavior,
      LambdaFunctionAssociations: {
        Quantity: 1,
        Items: [
          {
            EventType: 'origin-response',
            LambdaFunctionARN: latestPublishedVersion.FunctionArn,
            IncludeBody: false
          }
        ]
      }
    }
  }
  await cf
    .updateDistribution({ DistributionConfig: newDistroConfig, Id: distributionId, IfMatch: ETag })
    .promise()
}

module.exports = {
  configureBucketForHosting,
  configureSecurityHeadersInjectorLambda
}
