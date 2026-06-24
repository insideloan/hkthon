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
 * Wired to real code (2026-06-22): AppSync uses graphql/schema.graphql, the
 * orchestrator Lambda bundles lambda/ (BACKEND/AGENT), all query/mutation
 * resolvers route to it, `_emit*` mutations fan out via a DynamoDB Streams
 * Lambda (stream_fanout) bound to subscriptions by @aws_subscribe.
 */
export class HkthonStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // lambda/ 코드 번들에서 제외할 항목 — 가상환경/캐시/테스트는 런타임 불필요하고
    // 번들을 키워 Lambda 250MB(압축해제) 한도를 깨뜨린다(예: 프로파일러가 만든
    // .venv-prof 164MB로 배포 실패). git 미추적이라 .gitignore로는 못 막으므로
    // (CDK asset은 파일시스템을 그대로 zip) 여기서 명시 제외한다.
    const LAMBDA_BUNDLE_EXCLUDE = [
      '**/.venv*', '**/venv', '**/__pycache__', '**/*.pyc',
      '**/.pytest_cache', '**/.ruff_cache', 'tests', '**/tests',
    ];

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
    // Real BACKEND/AGENT bundle (lambda/orchestrator). Resolves every AppSync
    // query/mutation via handler.py fieldName dispatch. ORCHESTRATOR_MODE
    // defaults to script mode (scenario.json replay); live mode uses Transcribe.
    const orchestratorLogs = new logs.LogGroup(this, 'OrchestratorLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Runtime dependency layer (#83 block 5 / #50 precursor).
    // langchain/langgraph/langchain-aws/pydantic/httpx for the real orchestrator.
    // Built out-of-band into infra/layers/orchestrator-deps/ (gitignored — 110MB)
    // by scripts/build-layer.sh, using x86_64-manylinux wheels to match the
    // x86_64 Lambda. boto3/botocore omitted (in the runtime); amazon-transcribe
    // omitted until the STT bridge (AGENT-008) lands. Synth fails if the dir is
    // missing → run scripts/build-layer.sh first.
    const depsLayer = new lambda.LayerVersion(this, 'OrchestratorDeps', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'layers', 'orchestrator-deps')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      description: 'orchestrator runtime deps (langchain/langgraph/langchain-aws/pydantic/httpx)',
    });

    const orchestrator = new lambda.Function(this, 'Orchestrator', {
      runtime: lambda.Runtime.PYTHON_3_13,
      // Real BACKEND/AGENT bundle. Bundle root is lambda/ so `orchestrator` is an
      // importable package (handler.py uses relative imports `from .resolvers`).
      handler: 'orchestrator.handler.handler',
      layers: [depsLayer],
      // Bundle includes churn_risk_lexicon.json (copied from the SSOT at
      // hk-skills/reference/) so churn_risk.py loads it from /var/task at
      // runtime via LEXICON_LOCAL_PATH (#83 block 3).
      // ⚠️ #50 (CLOUD-008): when this asset is swapped to the real orchestrator
      // bundle (lambda/orchestrator/), carry the lexicon copy forward and keep
      // LEXICON_LOCAL_PATH pointing at it — the file must ship inside the asset.
      // The bundle copy is a build artifact of the SSOT; re-sync if the SSOT changes.
      // Real orchestrator bundle (lambda/orchestrator + AGENT/BACKEND code).
      // Bundle the parent lambda/ dir so the `orchestrator` package is importable.
      // The churn lexicon copy still ships via the bundle (LEXICON_LOCAL_PATH).
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda'), { exclude: LAMBDA_BUNDLE_EXCLUDE }),
      // 라이브 한 턴(nextTurn/audioChunk)은 agent 그래프(Bedrock classify+respond,
      // ~20s) + TTS(Typecast, best-effort) 직렬 실행이라 30s는 빠듯하다.
      // 90s로 늘려 한 턴이 잘리지 않게 한다(TTS 자체는 코드에서 12s로 짧게 끊음).
      timeout: cdk.Duration.seconds(90),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        ASSETS_BUCKET: bucket.bucketName,
        SCENARIO_KEY: 'scenarios/scenario.json',
        LEXICON_KEY: 'lexicon/churn_risk_lexicon.json',
        // churn_risk.py reads LEXICON_LOCAL_PATH (a real on-disk file), not S3.
        // The lexicon copy ships inside the orchestrator package
        // (lambda/orchestrator/churn_risk_lexicon.json); bundle root is lambda/
        // so at runtime it unzips to /var/task/orchestrator/. Missing file →
        // empty-lexicon fallback → churn score 0 (the failure #83 calls out).
        LEXICON_LOCAL_PATH: '/var/task/orchestrator/churn_risk_lexicon.json',
        // 기본 script(시나리오 재생). 라이브(STT/그래프/TTS) 활성화는 배포 시
        //   cdk deploy -c orchestratorMode=live
        // 로 옵트인 — 데모 안정성을 위해 기본값은 그대로 둔다.
        ORCHESTRATOR_MODE: this.node.tryGetContext('orchestratorMode') ?? 'script',
        LLM_MODEL: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        // router.py reads LLM_TIMEOUT_S (first-token timeout, seconds).
        LLM_TIMEOUT_S: '6',
        TRANSCRIBE_LANGUAGE: 'ko-KR',
        TYPECAST_SECRET_ARN: typecastSecret.secretArn,
        TYPECAST_MODEL: 'ssfm-v30',
        TYPECAST_VOICE: '혜라',
        // TTS mp3 업로드 버킷/화자 — typecast_tts.py가 읽는다(미설정 시 코드 기본값이
        // 실제 버킷과 달라 업로드 실패). assets 버킷을 재사용한다.
        TTS_S3_BUCKET: bucket.bucketName,
        TTS_VOICE_NAME: '혜라',
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
    // Real BACKEND schema (graphql/schema.graphql) — #49 (CLOUD-007).
    const api = new appsync.GraphqlApi(this, 'Api', {
      name: 'hkthon-api',
      definition: appsync.Definition.fromSchema(
        appsync.SchemaFile.fromAsset(
          path.join(__dirname, '..', '..', 'graphql', 'schema.graphql'),
        ),
      ),
      authorizationConfig: {
        // API_KEY: 프론트엔드(브라우저) 호출용 (기본).
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: { expires: cdk.Expiration.after(cdk.Duration.days(30)) },
        },
        // IAM: Streams 팬아웃 Lambda가 _emit* 뮤테이션을 SigV4로 호출하기 위함.
        // 추가 인증 모드로 등록해야 SigV4 호출이 401이 아닌 정상 처리됨.
        additionalAuthorizationModes: [
          { authorizationType: appsync.AuthorizationType.IAM },
        ],
      },
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR },
      xrayEnabled: false,
    });

    // Lambda data source: the orchestrator resolves every query/mutation.
    // Default Lambda-DS mapping passes { field, arguments, source, ... } as the
    // event; handler.py dispatches on event["fieldName"].
    const orchestratorDs = api.addLambdaDataSource('OrchestratorDataSource', orchestrator);

    // Query + mutation resolvers routed to the orchestrator. The `_emit*`
    // mutations are invoked by the Streams fan-out (below) and bound to
    // subscriptions via @aws_subscribe in the schema; they also need a resolver
    // so AppSync accepts the mutation call (NONE data source — pass-through).
    const QUERY_FIELDS = [
      'queue', 'call', 'mots', 'callSummary', 'customer', 'customers',
    ];
    const MUTATION_FIELDS = [
      'createCall', 'dialCall', 'approveProduct', 'transferToAgent',
      'sendLink', 'endCall', 'nextTurn', 'startAudio', 'audioChunk',
    ];
    // createCall/nextTurn existed in the placeholder stack under these construct
    // IDs. Reuse them so CloudFormation updates the resolvers in place instead of
    // creating new ones (which collides — AppSync allows one resolver per field,
    // and CFN create-before-delete would briefly need two → AlreadyExists).
    const MUTATION_RESOLVER_ID: Record<string, string> = {
      createCall: 'CreateCallResolver',
      nextTurn: 'NextTurnResolver',
    };
    for (const f of QUERY_FIELDS) {
      orchestratorDs.createResolver(`Q_${f}`, { typeName: 'Query', fieldName: f });
    }
    for (const f of MUTATION_FIELDS) {
      orchestratorDs.createResolver(
        MUTATION_RESOLVER_ID[f] ?? `M_${f}`,
        { typeName: 'Mutation', fieldName: f },
      );
    }

    // `_emit*` mutations: local (NONE) data source that just echoes the
    // arguments back as the payload, so the linked subscription fans out.
    const noneDs = api.addNoneDataSource('EmitNoneDataSource');
    const EMIT_FIELDS = [
      '_emitTurn', '_emitIndexUpdate', '_emitSpeechAnalysis', '_emitStrategyUpdate',
      '_emitComplianceState', '_emitMot', '_emitQueueUpdate', '_emitCallEnded',
    ];
    for (const f of EMIT_FIELDS) {
      noneDs.createResolver(`E_${f}`, {
        typeName: 'Mutation',
        fieldName: f,
        requestMappingTemplate: appsync.MappingTemplate.fromString(
          '{"version":"2017-02-28","payload": $util.toJson($context.arguments)}',
        ),
        responseMappingTemplate: appsync.MappingTemplate.fromString(
          '$util.toJson($context.result)',
        ),
      });
    }

    // ── DynamoDB Streams → AppSync fan-out Lambda (#28 / BACKEND-009) ────
    // Stream events → stream_fanout.handler calls the _emit* mutations over
    // the AppSync HTTP endpoint (IAM-signed). No separate WebSocket server.
    const fanout = new lambda.Function(this, 'StreamFanout', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'orchestrator.api.stream_fanout.handler',
      layers: [depsLayer],
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda'), { exclude: LAMBDA_BUNDLE_EXCLUDE }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        APPSYNC_URL: api.graphqlUrl,
        APPSYNC_API_ID: api.apiId,
        LOG_LEVEL: 'INFO',
      },
      logGroup: new logs.LogGroup(this, 'FanoutLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    // Stream trigger (newest-first; skip old records on cold start).
    fanout.addEventSourceMapping('FanoutStream', {
      eventSourceArn: table.tableStreamArn!,
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      retryAttempts: 2,
      bisectBatchOnError: true,
    });
    table.grantStreamRead(fanout);
    // Fan-out invokes AppSync mutations (GraphQL over HTTPS, IAM auth).
    fanout.addToRolePolicy(new iam.PolicyStatement({
      actions: ['appsync:GraphQL'],
      resources: [`arn:aws:appsync:${this.region}:${this.account}:apis/${api.apiId}/types/Mutation/*`],
    }));

    // ── Bedrock Guardrail ───────────────────────────────────────────────
    // Compliance loop for generated drafts (STACK.md §5). Model *account*
    // access is requested separately in #51 — this creates the guardrail
    // resource with the 금소법 (Financial Consumer Protection Act) policies
    // the orchestrator's compliance loop actually checks. #51 verifies blocking.
    //
    // ⚠️ compliance.py:_extract_violated parses topicPolicy + contentPolicy +
    // sensitiveInformationPolicy from the ApplyGuardrail response. The denied
    // topics below mirror the rule-fallback _POLICY_PATTERNS (CONFIRM_PROMISE /
    // FIXED_FIGURE / RATE_NEVER_RISES / RISK_DOWNPLAY) so the live Bedrock path
    // catches the same 금소법 violations the deterministic fallback does — without
    // them the Bedrock path would degrade to generic moderation only.
    const guardrail = new bedrock.CfnGuardrail(this, 'ComplianceGuardrail', {
      name: 'hkthon-compliance',
      description: 'Booth demo 금소법 compliance guardrail for orchestrator drafts.',
      blockedInputMessaging: '입력을 처리할 수 없습니다.',
      blockedOutputsMessaging: '컴플라이언스 정책에 따라 응답을 제공할 수 없습니다.',
      // 금소법 부당권유·확정수치·금리불변·리스크무마 — DENY 토픽으로 차단.
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: 'ConfirmPromise',
            type: 'DENY',
            definition:
              '심사 결과를 단정하거나 대출 승인·실행을 확약/보장하는 표현. ' +
              '금소법상 부당권유(확정·약속)에 해당.',
            examples: [
              '무조건 승인됩니다.',
              '제가 반드시 해드릴게요.',
              '대출은 확정이라고 보시면 됩니다.',
              '한도는 보장해 드립니다.',
            ],
          },
          {
            name: 'FixedFigure',
            type: 'DENY',
            definition:
              '예시·가정·심사 단서 없이 금리/한도/절감액 등 수치를 단정하는 표현. ' +
              '심사 전 확정 수치 제시는 금소법 위반.',
            examples: [
              '금리는 3.2%로 적용됩니다.',
              '한도는 5천만원 나옵니다.',
              '월 20만원 절감됩니다.',
            ],
          },
          {
            name: 'RateNeverRises',
            type: 'DENY',
            definition:
              '향후 금리가 오르지 않는다거나 변동이 없다고 단정하는 표현. ' +
              '금리 불변 단정은 금소법 위반.',
            examples: [
              '금리는 절대 안 오릅니다.',
              '앞으로 금리 변동은 전혀 없습니다.',
              '이 금리가 계속 유지됩니다.',
            ],
          },
          {
            name: 'RiskDownplay',
            type: 'DENY',
            definition:
              '연체·담보·중도상환 등으로 인한 불이익이나 위험이 없다고 무마하는 표현. ' +
              '리스크 무마는 금소법 위반.',
            examples: [
              '그럴 일 절대 없습니다.',
              '불이익은 전혀 없어요.',
              '연체돼도 문제 전혀 없습니다.',
              '걱정 안 하셔도 됩니다.',
            ],
          },
        ],
      },
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        ],
      },
      // PII / 제3자 정보노출 차단 (금소법 §1 공통요건). 표준 PII 엔터티는
      // ANONYMIZE(마스킹), 한국 고유 식별자(주민등록번호·계좌번호)는 정규식으로 BLOCK.
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: 'EMAIL', action: 'ANONYMIZE' },
          { type: 'PHONE', action: 'ANONYMIZE' },
          { type: 'NAME', action: 'ANONYMIZE' },
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
          { type: 'INTERNATIONAL_BANK_ACCOUNT_NUMBER', action: 'BLOCK' },
        ],
        regexesConfig: [
          {
            name: 'KoreanRRN',
            description: '주민등록번호 (YYMMDD-NNNNNNN)',
            pattern: '\\d{6}-\\d{7}',
            action: 'BLOCK',
          },
          {
            name: 'KoreanBankAccount',
            description: '국내 계좌번호 (10~14자리, 하이픈 포함)',
            pattern: '\\d{2,6}-\\d{2,6}-\\d{2,6}',
            action: 'BLOCK',
          },
        ],
      },
    });

    // Let the orchestrator apply this specific guardrail.
    // Names must match what compliance.py reads (BEDROCK_GUARDRAIL_ID /
    // BEDROCK_GUARDRAIL_VERSION) — otherwise compliance silently rule-falls-back.
    orchestrator.addEnvironment('BEDROCK_GUARDRAIL_ID', guardrail.attrGuardrailId);
    orchestrator.addEnvironment('BEDROCK_GUARDRAIL_VERSION', guardrail.attrVersion);

    // ── Amplify Hosting (monorepo: frontend/) ───────────────────────────
    // App + build spec + env slot. Repo connection (GitHub App) + branch
    // auto-deploy are wired in #44 (CLOUD-003) via console so no OAuth token
    // is baked into IaC. appRoot=frontend targets this monorepo subdir.
    const amplifyApp = new amplify.CfnApp(this, 'FrontendApp', {
      name: 'hkthon-frontend',
      platform: 'WEB_COMPUTE', // Next.js 15 SSR/ISR
      environmentVariables: [
        { name: 'NEXT_PUBLIC_APPSYNC_URL', value: api.graphqlUrl },
        // The frontend's Amplify client needs BOTH url + apiKey — without the
        // key, configureAppSync() bails and every query fails 'NoCredentials'
        // (empty dashboard). NEXT_PUBLIC_* is baked at build time, so this must
        // be present before `pnpm build` runs.
        { name: 'NEXT_PUBLIC_APPSYNC_API_KEY', value: api.apiKey ?? '' },
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
    new cdk.CfnOutput(this, 'StreamFanoutName', { value: fanout.functionName });
    new cdk.CfnOutput(this, 'GuardrailId', { value: guardrail.attrGuardrailId });
    new cdk.CfnOutput(this, 'AmplifyAppId', { value: amplifyApp.attrAppId });
  }
}
