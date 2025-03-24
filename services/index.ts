import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Signer, SignerConfig } from '@aws-sdk/rds-signer';
import { Client } from 'pg';

const { DB_IAM_USER, SECRET_ARN, REGION } = process.env;

interface DbCredentials {
  dbname: string;
  host: string;
  password: string;
  port: number;
  username: string;
}

const getDbCredentials = async () => {
  const secretArn = SECRET_ARN;
  if (!secretArn) {
    throw new Error('SECRET_ARN is not defined');
  }

  const secretsClient = new SecretsManagerClient({});
  const getSecretValueCmd = new GetSecretValueCommand({ SecretId: secretArn });
  const secretResult = await secretsClient.send(getSecretValueCmd);

  if (!secretResult.SecretString) {
    throw new Error(`No SecretString returned for ${secretArn}`);
  }

  const secretJson = JSON.parse(secretResult.SecretString) as DbCredentials;

  return {
    dbHost: secretJson.host,
    dbName: secretJson.dbname,
    dbPassword: secretJson.password,
    dbPort: secretJson.port,
    dbRootUser: secretJson.username,
    dbIamUser: DB_IAM_USER ?? 'iam_user_not_set',
  };
};

const createNewRdsClient = (dbHost: string, dbPort: number, dbName: string, dbUser: string, dbPassword: string) =>
  new Client({
    database: dbName,
    host: dbHost,
    password: dbPassword,
    port: dbPort,
    ssl: { rejectUnauthorized: false },
    user: dbUser,
  });

const createIamUser = async (
  dbHost: string,
  dbPort: number,
  dbName: string,
  dbRootUser: string,
  dbPassword: string,
  dbIamUser: string,
) => {
  const client = createNewRdsClient(dbHost, dbPort, dbName, dbRootUser, dbPassword);
  try {
    await client.connect();
    console.log('Connected to DB as root user');

    const createUserSQL = `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${dbIamUser}') THEN
          CREATE USER ${dbIamUser};
          GRANT rds_iam TO ${dbIamUser};
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${dbIamUser};
        END IF;
      END
      $$;
    `;
    await client.query(createUserSQL);
    console.log(`Successfully ensured IAM user "${dbIamUser}" exists with correct privileges.`);
  } catch (error) {
    console.error('Error creating IAM user:', error);
  } finally {
    await client.end();
  }
};

const connectAsIamUser = async (
  dbHost: string,
  dbPort: number,
  dbName: string,
  dbIamUser: string,
) => {
  const signerConfig: SignerConfig = {
    hostname: dbHost,
    port: dbPort,
    region: REGION ?? 'us-east-1',
    username: dbIamUser,
  };
  const signer = new Signer(signerConfig);

  const token = await signer.getAuthToken();
  console.log('Retrieved IAM auth token.');

  const client = createNewRdsClient(dbHost, dbPort, dbName, dbIamUser, token);
  await client.connect();
  console.log(`Successfully connected to DB as IAM user: ${dbIamUser}`);
  try {
    const listAllTablesSQL = `SELECT table_name FROM information_schema.tables;`;
    const allTablesResult = await client.query(listAllTablesSQL);
    console.log(`All tables in DB:`, allTablesResult.rows);
  } catch (error) {
    console.error('Error listing tables:', error);
  } finally {
    console.log('Closing IAM DB connection');
    await client.end();
  }
}

export const handler = async (
  event: any,
) => {
  console.log('Event:', event);

  const { dbHost, dbName, dbPassword, dbPort, dbRootUser, dbIamUser } = await getDbCredentials();

  await createIamUser(dbHost, dbPort, dbName, dbRootUser, dbPassword, dbIamUser);
  console.log(`Ensured IAM user "${dbIamUser}" exists and connected successfully using username and password.`);
  
  await connectAsIamUser(dbHost, dbPort, dbName, dbIamUser);
  console.log(`Successful connection to DB with IAM User.`);

  return {
    body: JSON.stringify({ message: 'IAM user created and connected successfully.' }),
    statusCode: 200,
  };
};
