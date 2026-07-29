import { MigrationInterface, QueryRunner } from "typeorm";

export class SafeFeedbackTables2026060200010 implements MigrationInterface {
  name = "SafeFeedbackTables2026060200010";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_fact_feedback_counts (
        aggregation_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        broker_org_id VARCHAR(120) NOT NULL,
        submitter_class VARCHAR(32) NOT NULL DEFAULT 'unknown',
        provider_npi VARCHAR(10) NOT NULL DEFAULT '',
        provider_id VARCHAR(191) NOT NULL DEFAULT '',
        fact_type VARCHAR(60) NOT NULL,
        normalized_fact_value VARCHAR(255) NOT NULL,
        validation_status VARCHAR(40) NOT NULL,
        reason_code VARCHAR(80) NOT NULL,
        feedback_day DATE NOT NULL,
        feedback_count INT UNSIGNED DEFAULT 0 NOT NULL,
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_ORG (broker_org_id),
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_ORG_CLASS (broker_org_id, submitter_class),
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_ORG_DAY (broker_org_id, feedback_day),
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_PROVIDER (provider_npi, provider_id),
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_FACT (fact_type, normalized_fact_value),
        PRIMARY KEY (aggregation_key)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE = InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_phone_call_counts (
        aggregation_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        broker_org_id VARCHAR(120) NOT NULL,
        provider_npi VARCHAR(10) NOT NULL DEFAULT '',
        provider_id VARCHAR(191) NOT NULL DEFAULT '',
        normalized_phone VARCHAR(30) NOT NULL,
        click_day DATE NOT NULL,
        click_count INT UNSIGNED DEFAULT 0 NOT NULL,
        INDEX IDX_AI_PROVIDER_PHONE_ORG (broker_org_id),
        INDEX IDX_AI_PROVIDER_PHONE_ORG_DAY (broker_org_id, click_day),
        INDEX IDX_AI_PROVIDER_PHONE_PROVIDER (provider_npi, provider_id),
        PRIMARY KEY (aggregation_key)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE = InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_fact_consensus (
        aggregation_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        broker_org_id VARCHAR(120) NOT NULL,
        provider_npi VARCHAR(10) NOT NULL DEFAULT '',
        provider_id VARCHAR(191) NOT NULL DEFAULT '',
        fact_type VARCHAR(60) NOT NULL,
        normalized_fact_value VARCHAR(255) NOT NULL,
        feedback_day DATE NOT NULL,
        positive_count INT UNSIGNED DEFAULT 0 NOT NULL,
        negative_count INT UNSIGNED DEFAULT 0 NOT NULL,
        INDEX IDX_AI_PROVIDER_CONSENSUS_ORG (broker_org_id),
        INDEX IDX_AI_PROVIDER_CONSENSUS_ORG_DAY (broker_org_id, feedback_day),
        INDEX IDX_AI_PROVIDER_CONSENSUS_PROVIDER (provider_npi, provider_id),
        INDEX IDX_AI_PROVIDER_CONSENSUS_FACT (fact_type, normalized_fact_value),
        PRIMARY KEY (aggregation_key)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE = InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS ai_provider_fact_consensus");
    await queryRunner.query("DROP TABLE IF EXISTS ai_provider_phone_call_counts");
    await queryRunner.query("DROP TABLE IF EXISTS ai_provider_fact_feedback_counts");
  }
}
