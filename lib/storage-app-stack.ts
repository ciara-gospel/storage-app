import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';

export class StorageAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 🔹 creation du reseau VPC (Virtual Private Cloud)
    const vpc = new ec2.Vpc(this, 'StorageAppVPC', {
      maxAzs: 2,
    });

    // 🔹 je cree mon s3 bucket pour stocker les fichiers.
    const bucket = new s3.Bucket(this, 'StorageFilesBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // 🔹 ici c'est ma base de donnees avec RDS Postgres pour les metadonnees des fichiers et utilisateurs.
    const dbInstance = new rds.DatabaseInstance(this, 'StorageAppDB', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_5,
      }),
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      multiAz: false,
      allocatedStorage: 20,
      publiclyAccessible: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // 🔹 4. ECR Repository
    const repository = new ecr.Repository(this, 'StorageAppRepo', {
      repositoryName: 'storage-app',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // je cree un cluster ECS (espace de gestion des conteneurs)
    const cluster = new ecs.Cluster(this, 'StorageAppCluster', {
      vpc,
    });
    // IAM pour mes conteneurs ECS(permissions)
    const taskRole = new iam.Role(this, 'StorageAppTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Permissions ECS vers S3 et RDS ici je donne a mon conteneurs le droit de lire/ ecrire dans mon s3 bucket et de se conecter a ma base RDS
    bucket.grantReadWrite(taskRole);
    dbInstance.grantConnect(taskRole);

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'StorageAppService', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
        containerPort: 3000,
        taskRole,
        environment: {
          DATABASE_URL: dbInstance.instanceEndpoint.hostname,
          S3_BUCKET: bucket.bucketName,
        },
      },
      publicLoadBalancer: true,
      desiredCount: 1,
    });

    // authentification avec amazon Cognito sans a gerer les mots de passe.
    const userPool = new cognito.UserPool(this, 'StorageAppUserPool', {
      userPoolName: 'StorageAppUsers',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cognito.UserPoolClient(this, 'StorageAppUserPoolClient', {
      userPool,
      generateSecret: false,
    });

    // 🔹 7. Outputs( les informations qui seront retouner apres le deploiement)
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'DatabaseEndpoint', { value: dbInstance.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'LoadBalancerURL', { value: fargateService.loadBalancer.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
  }
}
