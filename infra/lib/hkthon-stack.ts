import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as path from 'path';

/**
 * HkthonStack — single serverless stack for the AI 상담 코파일럿 booth demo.
 *
 * Provisions all AWS resources (CLOUD-011 / #54). Follow-up CLOUD issues
 * connect/verify against what this stack creates:
 *   - #46 (CLOUD-005)  DynamoDB / S3 verify + hand identifiers to DATA
 *   - #49 (CLOUD-007)  apply BACKEND graphql/schema.graphql to this AppSync API
 *   - #50 (CLOUD-008)  deploy orchestrator code bundle into this Lambda
 *   - #51 (CLOUD-009)  request Bedrock model access + verify guardrail
 *   - #44 (CLOUD-003)  verify Amplify auto-deploy + env injection
 *   - #52 (CLOUD-010)  audit IAM least-privilege + extend CloudWatch alarms
 *
 * NOTE: the Lambda handler and GraphQL schema here are intentionally
 * placeholders so `cdk synth` passes standalone, before AGENT/BACKEND code
 * exists. They are replaced in #49/#50.
 */
export class HkthonStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── DynamoDB single table (+ Streams) ───────────────────────────────
    // Single-table design (PK/SK). Streams feed AppSync subscription fan-out.
    const table = new dynamodb.Table(this, 'CallTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // booth demo — tear down cleanly
    });

    // ── S3 bucket (scenario.json · lexicon · mp3) ───────────────────────
    const bucket = new s3.Bucket(this, 'AssetsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── Secrets Manager (TYPECAST_API_KEY etc.) ─────────────────────────
    // Value is injected out-of-band (console/CLI); never committed. The
    // orchestrator reads it at runtime — no hardcoded secret in code.
    const typecastSecret = new secretsmanager.Secret(this, 'TypecastApiKey', {
      description: 'Typecast TTS API key (X-API-KEY). Set value via CLI/console.',
      secretName: 'hkthon/typecast-api-key',
    });

    // ── Lambda orchestrator (Python 3.13) ───────────────────────────────
    // Placeholder bundle (infra/lambda-placeholder/) that resolves createCall /
    // nextTurn by writing real DynamoDB items — proves the AppSync->Lambda->
    // DynamoDB path in script mode. Replaced by the real orchestrator bundle in
    // CLOUD-008 (#50). ORCHESTRATOR_MODE defaults to script mode.
    const orchestratorLogs = new logs.LogGroup(this, 'OrchestratorLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const orchestrator = new lambda.Function(this, 'Orchestrator', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda-placeholder')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        ASSETS_BUCKET: bucket.bucketName,
        SCENARIO_KEY: 'scenarios/scenario.json',
        LEXICON_KEY: 'lexicon/churn_risk_lexicon.json',
        ORCHESTRATOR_MODE: 'script',
        LLM_MODEL: 'global.anthropic.claude-sonnet-4-6',
        TRANSCRIBE_LANGUAGE: 'ko-KR',
        TYPECAST_SECRET_ARN: typecastSecret.secretArn,
        TYPECAST_MODEL: 'ssfm-v30',
        TYPECAST_VOICE: '혜라',
        LOG_LEVEL: 'INFO',
      },
      logGroup: orchestratorLogs,
    });

    // Least-privilege grants for the orchestrator role.
    table.grantReadWriteData(orchestrator);
    bucket.grantReadWrite(orchestrator);
    typecastSecret.grantRead(orchestrator);

    // Bedrock (Converse) + Guardrails apply + Transcribe streaming.
    // Scoped to actions; #52 audits/tightens resources further.
    // Bedrock: scope InvokeModel to foundation models + the cross-region
    // inference profile (the `global.anthropic.*` model id resolves via an
    // inference profile, which in turn invokes region foundation models).
    // ApplyGuardrail is scoped to our guardrail in the next statement.
    orchestrator.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:*::foundation-model/*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));
    orchestrator.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:ApplyGuardrail'],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:guardrail/*`,
      ],
    }));
    // Transcribe streaming does NOT support resource-level permissions
    // (AWS constraint) — `*` is required here and is intentional, not loose.
    orchestrator.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'transcribe:StartStreamTranscription',
        'transcribe:StartStreamTranscriptionWebSocket',
      ],
      resources: ['*'],
    }));

    // ── AppSync GraphQL API ─────────────────────────────────────────────
    // Placeholder schema; #49 applies the real graphql/schema.graphql.
    const api = new appsync.GraphqlApi(this, 'Api', {
      name: 'hkthon-api',
      definition: appsync.Definition.fromSchema(
        appsync.SchemaFile.fromAsset(
          path.join(__dirname, 'schema.placeholder.graphql'),
        ),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: { expires: cdk.Expiration.after(cdk.Duration.days(30)) },
        },
      },
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR },
      xrayEnabled: false,
    });

    // Data sources: DynamoDB (resolver direct) + Lambda (orchestrator).
    api.addDynamoDbDataSource('TableDataSource', table);
    const orchestratorDs = api.addLambdaDataSource('OrchestratorDataSource', orchestrator);

    // Placeholder resolvers: route createCall / nextTurn to the orchestrator
    // Lambda. Default Lambda-DS request/response mapping passes the GraphQL
    // field + arguments through as the event. #49 replaces these with the
    // resolvers defined against BACKEND's real schema.
    orchestratorDs.createResolver('CreateCallResolver', {
      typeName: 'Mutation',
      fieldName: 'createCall',
    });
    orchestratorDs.createResolver('NextTurnResolver', {
      typeName: 'Mutation',
      fieldName: 'nextTurn',
    });

    // ── Bedrock Guardrail ───────────────────────────────────────────────
    // Compliance loop for generated drafts (STACK.md §5). Model *account*
    // access is requested separately in #51 — this only creates the
    // guardrail resource + a baseline content policy. #51 verifies blocking.
    const guardrail = new bedrock.CfnGuardrail(this, 'ComplianceGuardrail', {
      name: 'hkthon-compliance',
      description: 'Booth demo compliance guardrail for orchestrator drafts.',
      blockedInputMessaging: '입력을 처리할 수 없습니다.',
      blockedOutputsMessaging: '컴플라이언스 정책에 따라 응답을 제공할 수 없습니다.',
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        ],
      },
    });

    // Let the orchestrator apply this specific guardrail.
    orchestrator.addEnvironment('GUARDRAIL_ID', guardrail.attrGuardrailId);
    orchestrator.addEnvironment('GUARDRAIL_VERSION', guardrail.attrVersion);

    // ── Amplify Hosting (monorepo: frontend/) ───────────────────────────
    // App + build spec + env slot. Repo connection (GitHub App) + branch
    // auto-deploy are wired in #44 (CLOUD-003) via console so no OAuth token
    // is baked into IaC. appRoot=frontend targets this monorepo subdir.
    const amplifyApp = new amplify.CfnApp(this, 'FrontendApp', {
      name: 'hkthon-frontend',
      platform: 'WEB_COMPUTE', // Next.js 15 SSR/ISR
      environmentVariables: [
        { name: 'NEXT_PUBLIC_APPSYNC_URL', value: api.graphqlUrl },
        { name: 'AMPLIFY_MONOREPO_APP_ROOT', value: 'frontend' },
      ],
      buildSpec: [
        'version: 1',
        'applications:',
        '  - appRoot: frontend',
        '    frontend:',
        '      phases:',
        '        preBuild:',
        '          commands:',
        // Enable corepack and let it use the pnpm version pinned in
        // frontend/package.json#packageManager. NOT `pnpm@latest`: latest
        // enables a minimumReleaseAge supply-chain policy that rejects very
        // recently published transitive deps (e.g. semver), breaking CI while
        // local installs pass. Pinning keeps local == CI.
        '            - corepack enable',
        '            - pnpm install --frozen-lockfile',
        '        build:',
        '          commands:',
        '            - pnpm run build',
        '      artifacts:',
        '        baseDirectory: .next',
        '        files:',
        '          - "**/*"',
        '      cache:',
        '        paths:',
        '          - node_modules/**/*',
      ].join('\n'),
    });

    // ── CloudWatch alarms + dashboard (CLOUD-010 / #52) ─────────────────
    // Baseline observability: alarm on orchestrator errors and AppSync 5xx.
    const lambdaErrors = new cloudwatch.Alarm(this, 'OrchestratorErrorsAlarm', {
      alarmName: 'hkthon-orchestrator-errors',
      metric: orchestrator.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const appsync5xx = new cloudwatch.Alarm(this, 'AppSync5xxAlarm', {
      alarmName: 'hkthon-appsync-5xx',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/AppSync',
        metricName: '5XXError',
        dimensionsMap: { GraphQLAPIId: api.apiId },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'hkthon',
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Orchestrator invocations / errors',
        left: [orchestrator.metricInvocations(), orchestrator.metricErrors()],
      }),
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarms',
        alarms: [lambdaErrors, appsync5xx],
      }),
    );

    // ── CloudFormation outputs ──────────────────────────────────────────
    // Consumed by follow-up issues + frontend .env.local distribution (#55).
    new cdk.CfnOutput(this, 'AppSyncUrl', { value: api.graphqlUrl });
    new cdk.CfnOutput(this, 'AppSyncApiKey', { value: api.apiKey ?? 'n/a' });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'AssetsBucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'OrchestratorName', { value: orchestrator.functionName });
    new cdk.CfnOutput(this, 'GuardrailId', { value: guardrail.attrGuardrailId });
    new cdk.CfnOutput(this, 'AmplifyAppId', { value: amplifyApp.attrAppId });
  }
}
