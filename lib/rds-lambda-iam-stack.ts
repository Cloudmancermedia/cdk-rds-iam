import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SecurityGroup, SubnetType, Port, InstanceType, InstanceClass, InstanceSize, IVpc, ISubnet } from 'aws-cdk-lib/aws-ec2';
import { DatabaseCluster, DatabaseClusterEngine, AuroraPostgresEngineVersion, Credentials, ClusterInstance, DatabaseSecret } from 'aws-cdk-lib/aws-rds';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Function, Runtime, Code, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import path from 'path';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

const dbName = 'main_db';
const dbRootUser = 'postgres_admin';
const dbIamUser = 'db_iam_user';

export class RdsLambdaIamStack extends Stack {
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

    // Security Group for Aurora
    const dbSecurityGroup = new SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    // Security Group for Lambda
    const lambdaSecurityGroup = new SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    // Allow Lambda to access Aurora on port 5432
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
      iamAuthentication: true,
    });
  
    const pgLayer = new LayerVersion(this, 'PgLayer', {
      code: Code.fromAsset('lambda-layers/pg-layer'),
      compatibleRuntimes: [Runtime.NODEJS_22_X],
      description: 'Layer for PostgreSQL client (pg) and AWS SDK',
    });

    const lambdaFunction = new Function(this, 'AuroraLambda', {
      runtime: Runtime.NODEJS_22_X,
      code: Code.fromAsset('services'),
      handler: 'handler.main',
      timeout: Duration.seconds(10),
      layers: [pgLayer],
      vpc,
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_IAM_USER: dbIamUser,
        SECRET_ARN: cluster.secret?.secretArn ?? '',
        REGION: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
      },
    });

    // Allow Lambda to access Secrets Manager
    cluster.secret!.grantRead(lambdaFunction);
    // Allow Lambda to connect to RDS using IAM
    lambdaFunction.addToRolePolicy(new PolicyStatement({
      actions: [
        'rds-db:connect',
      ],
      resources: [
        `arn:aws:rds-db:${this.region}:${this.account}:dbRootUser:${cluster.clusterIdentifier}/${dbRootUser}`,
        `arn:aws:rds-db:${this.region}:${this.account}:dbRootUser:${cluster.clusterResourceIdentifier}/${dbIamUser}`,
      ],
    }));

  }
}
