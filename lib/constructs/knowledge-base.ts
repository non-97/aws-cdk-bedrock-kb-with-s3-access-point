import * as cdk from "aws-cdk-lib";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3vectors from "aws-cdk-lib/aws-s3vectors";
import { Construct } from "constructs";
import type { S3AccessPointConfig } from "../../config.js";

const DEFAULT_EMBEDDING_MODEL_ID = "amazon.nova-2-multimodal-embeddings-v1:0";

export interface KnowledgeBaseProps {
  /** S3 Vectors バケット名 */
  readonly vectorBucketName: string;
  /**
   * FSx for NetApp ONTAP の S3 Access Point 設定の配列
   * 未指定または空配列の場合、DataSource は作成されない
   *
   * @default []
   */
  readonly s3AccessPoints?: S3AccessPointConfig[];
  /**
   * エンベディングモデル ID
   *
   * @default "amazon.nova-2-multimodal-embeddings-v1:0"
   */
  readonly embeddingModelId?: string;
  /**
   * エンベディングの次元数
   * 未指定の場合、モデルのデフォルト値が使用される
   */
  readonly embeddingDimensions?: number;
}

export class KnowledgeBase extends Construct {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly dataSourceIds: string[];

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;
    const accountId = cdk.Stack.of(this).account;
    const accessPoints = props.s3AccessPoints ?? [];
    const embeddingModelId =
      props.embeddingModelId ?? DEFAULT_EMBEDDING_MODEL_ID;
    const isMultimodal = embeddingModelId.includes("multimodal");
    const dimensions = props.embeddingDimensions ?? 3072;

    // S3 Vectors: ベクトルバケット & インデックス
    const vectorBucket = new s3vectors.CfnVectorBucket(this, "VectorBucket", {
      vectorBucketName: props.vectorBucketName,
    });
    vectorBucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const vectorIndex = new s3vectors.CfnIndex(this, "VectorIndex", {
      vectorBucketName: props.vectorBucketName,
      dimension: dimensions,
      distanceMetric: "euclidean",
      dataType: "float32",
      metadataConfiguration: {
        nonFilterableMetadataKeys: [
          "AMAZON_BEDROCK_TEXT",
          "AMAZON_BEDROCK_METADATA",
        ],
      },
    });
    vectorIndex.addDependency(vectorBucket);
    vectorIndex.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // IAM Role: Bedrock Knowledge Base 用
    const role = new iam.Role(this, "Role", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
    });

    // S3 Access Point へのアクセス権限 (エイリアス + Access Point ARN の両形式が必要)
    if (accessPoints.length > 0) {
      const accessPointResources = accessPoints.flatMap((ap) => [
        ap.alias,
        `${ap.alias}/*`,
        ap.arn,
        `${ap.arn}/object/*`,
      ]);
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:ListBucket"],
          resources: accessPointResources,
        })
      );
    }

    // S3 Vectors へのアクセス権限
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:QueryVectors",
          "s3vectors:GetIndex",
        ],
        resources: [`arn:aws:s3vectors:${region}:${accountId}:bucket/*`],
      })
    );

    // Bedrock Embedding モデルへのアクセス権限
    if (isMultimodal) {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:aws:bedrock:${region}::foundation-model/amazon.nova-*-multimodal-embeddings-*`,
            `arn:aws:bedrock:${region}:${accountId}:async-invoke/*`,
          ],
        })
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:GetAsyncInvoke"],
          resources: [`arn:aws:bedrock:${region}:${accountId}:async-invoke/*`],
        })
      );
    } else {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:aws:bedrock:${region}::foundation-model/${embeddingModelId}`,
          ],
        })
      );
    }

    // マルチモーダルストレージ (マルチモーダルモデルの場合のみ)
    const supplementalDataStorageConfiguration = isMultimodal
      ? (() => {
          const multimodalStorageBucket = new s3.Bucket(
            this,
            "MultimodalStorage",
            {
              removalPolicy: cdk.RemovalPolicy.DESTROY,
              autoDeleteObjects: true,
              blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            }
          );
          multimodalStorageBucket.grantReadWrite(role);

          return {
            supplementalDataStorageLocations: [
              {
                supplementalDataStorageLocationType: "S3",
                s3Location: {
                  uri: `s3://${multimodalStorageBucket.bucketName}`,
                },
              },
            ],
          };
        })()
      : undefined;

    const embeddingModelConfiguration = isMultimodal
      ? undefined
      : { bedrockEmbeddingModelConfiguration: { dimensions } };

    // Bedrock Knowledge Base
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, "Resource", {
      name: cdk.Names.uniqueResourceName(this, { maxLength: 63 }),
      roleArn: role.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${region}::foundation-model/${embeddingModelId}`,
          embeddingModelConfiguration,
          supplementalDataStorageConfiguration,
        },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: {
          indexArn: vectorIndex.attrIndexArn,
        },
      },
    });
    knowledgeBase.node.addDependency(role);
    knowledgeBase.addDependency(vectorIndex);

    // Access Point ごとに Data Source を作成 (指定時のみ、エイリアスを使用)
    this.dataSourceIds = accessPoints.map((ap, index) => {
      const dataSource = new bedrock.CfnDataSource(this, `DataSource${index}`, {
        name: `datasource-${index}`,
        knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
        dataSourceConfiguration: {
          type: "S3",
          s3Configuration: {
            bucketArn: ap.alias,
          },
        },
      });
      return dataSource.attrDataSourceId;
    });

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;
  }
}
