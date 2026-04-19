import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

export interface IngestionScheduleProps {
  readonly knowledgeBaseId: string;
  readonly dataSourceIds: string[];
  /**
   * 同期スケジュール式
   *
   * @default "rate(1 hour)"
   */
  readonly schedule?: string;
}

export class IngestionSchedule extends Construct {
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: IngestionScheduleProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;
    const accountId = cdk.Stack.of(this).account;
    const schedule = props.schedule ?? "rate(1 hour)";

    // 各 DataSource に対して StartIngestionJob を呼び出すタスクを作成
    const ingestionTasks = props.dataSourceIds.map(
      (dataSourceId, index) =>
        new tasks.CallAwsService(this, `StartIngestion${index}`, {
          service: "bedrockagent",
          action: "startIngestionJob",
          parameters: {
            KnowledgeBaseId: props.knowledgeBaseId,
            DataSourceId: dataSourceId,
          },
          iamResources: [
            `arn:aws:bedrock:${region}:${accountId}:knowledge-base/${props.knowledgeBaseId}`,
          ],
        }).addRetry({
          errors: ["States.ALL"],
          maxAttempts: 3,
          backoffRate: 2,
          interval: cdk.Duration.seconds(10),
        }),
    );

    // 複数 DataSource を並列実行
    const definition: sfn.IChainable =
      ingestionTasks.length === 1
        ? ingestionTasks[0]
        : (() => {
            const parallel = new sfn.Parallel(this, "ParallelIngestion");
            for (const task of ingestionTasks) {
              parallel.branch(task);
            }
            return parallel;
          })();

    const stateMachine = new sfn.StateMachine(this, "StateMachine", {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
    });

    // EventBridge Scheduler 用の IAM Role
    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    stateMachine.grantStartExecution(schedulerRole);

    // EventBridge Scheduler
    new scheduler.CfnSchedule(this, "Schedule", {
      scheduleExpression: schedule,
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: stateMachine.stateMachineArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    this.stateMachineArn = stateMachine.stateMachineArn;
  }
}
