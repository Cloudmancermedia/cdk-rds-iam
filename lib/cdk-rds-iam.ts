import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SecurityGroup, SubnetType, Port } from 'aws-cdk-lib/aws-ec2';
import { DatabaseCluster, DatabaseClusterEngine, AuroraPostgresEngineVersion, Credentials, ClusterInstance } from 'aws-cdk-lib/aws-rds';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Function, Runtime, Code, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { InvocationType, Trigger } from 'aws-cdk-lib/triggers';

const dbName = 'main_db';
const dbRootUser = 'postgres_admin';
const dbIamUser = 'db_iam_user';

export class CdkRdsIamStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'AuroraVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Application',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const dbSecurityGroup = new SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    const lambdaSecurityGroup = new SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    dbSecurityGroup.addIngressRule(lambdaSecurityGroup, Port.tcp(5432), 'Allow Lambda access');

    const credentials = Credentials.fromGeneratedSecret(dbRootUser);

    const cluster = new DatabaseCluster(this, 'AuroraCluster', {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_16_6,
      }),
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      },
      credentials,
      securityGroups: [dbSecurityGroup],
      defaultDatabaseName: dbName,
      removalPolicy: RemovalPolicy.DESTROY,
      writer: ClusterInstance.serverlessV2('reader-serverless'),
      readers:[
        ClusterInstance.serverlessV2('writer-serverless', {
          scaleWithWriter: true,
        }),
      ],
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      iamAuthentication: true,
    });
  
    const pgLayer = new LayerVersion(this, 'PgLayer', {
      code: Code.fromAsset('lambda-layers/pg-layer'),
      compatibleRuntimes: [Runtime.NODEJS_22_X],
      description: 'Layer for PostgreSQL client (pg) and AWS SDK',
    });

    const lambdaFunction = new Function(this, 'AuroraLambda', {
      runtime: Runtime.NODEJS_22_X,
      code: Code.fromAsset('dist/services'),
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      layers: [pgLayer],
      vpc,
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_IAM_USER: dbIamUser,
        SECRET_ARN: cluster.secret?.secretArn ?? '',
        REGION: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
      },
    });
    cluster.secret!.grantRead(lambdaFunction);
    lambdaFunction.addToRolePolicy(new PolicyStatement({
      actions: [
        'rds-db:connect',
      ],
      resources: [
        `arn:aws:rds-db:${this.region}:${this.account}:dbuser:${cluster.clusterResourceIdentifier}/${dbIamUser}`,
      ],
    }));

    new Trigger(this, 'TriggerOnDeploy', {
      executeAfter: [cluster],
      handler: lambdaFunction,
      invocationType: InvocationType.EVENT,
      timeout: Duration.minutes(10),
    });
  }
}
