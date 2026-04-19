export interface EmbeddingModelConfig {
  /**
   * エンベディングモデル ID
   *
   * @default "amazon.nova-2-multimodal-embeddings-v1:0"
   */
  readonly modelId?: string;
  /**
   * エンベディングの次元数
   * 未指定の場合、モデルのデフォルト値が使用される
   */
  readonly dimensions?: number;
}

export interface S3AccessPointConfig {
  /** CfnDataSource 用: エイリアスのバケット ARN 形式 (arn:aws:s3:::...-ext-s3alias) */
  readonly alias: string;
  /** IAM ポリシー用: 実際の Access Point ARN (arn:aws:s3:region:account:accesspoint/name) */
  readonly arn: string;
}

export interface AppConfig {
  /** S3 Vectors バケット名 */
  readonly vectorBucketName: string;
  /**
   * FSx for NetApp ONTAP の S3 Access Point 設定の配列
   * 未指定または空配列の場合、DataSource と同期スケジュールは作成されない
   *
   * @default []
   */
  readonly s3AccessPoints?: S3AccessPointConfig[];
  /**
   * データソース同期のスケジュール
   *
   * @default "rate(1 hour)"
   */
  readonly syncSchedule?: string;
  /**
   * エンベディングモデルの設定
   *
   * @default { modelId: "amazon.nova-2-multimodal-embeddings-v1:0" }
   */
  readonly embeddingModel?: EmbeddingModelConfig;
}

export const appConfig: AppConfig = {
  vectorBucketName: "non-97-bedrock-kb-vectors",
  s3AccessPoints: [
    {
      alias: "arn:aws:s3:::<S3 Access Pointエイリアス>",
      arn: "arn:aws:s3:us-east-1:<AWSアカウントID>:accesspoint/<S3 Access Point名>",
    },
    {
      alias: "arn:aws:s3:::<S3 Access Pointエイリアス>",
      arn: "arn:aws:s3:us-east-1:<AWSアカウントID>:accesspoint/S3 Access Point名",
    },
  ],
  syncSchedule: "rate(1 hour)",
};
