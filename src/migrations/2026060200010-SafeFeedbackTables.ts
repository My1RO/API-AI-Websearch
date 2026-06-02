import { MigrationInterface, QueryRunner } from "typeorm";

export class SafeFeedbackTables2026060200010 implements MigrationInterface {
  name = "SafeFeedbackTables2026060200010";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_fact_feedback (
        id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
        broker_org_id VARCHAR(120) NOT NULL,
        provider_npi VARCHAR(10) DEFAULT NULL,
        provider_id VARCHAR(191) DEFAULT NULL,
        fact_type VARCHAR(60) NOT NULL,
        normalized_fact_value VARCHAR(255) NOT NULL,
        validation_status VARCHAR(40) NOT NULL,
        reason_code VARCHAR(80) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_ORG (broker_org_id),
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_PROVIDER (provider_npi, provider_id),
        INDEX IDX_AI_PROVIDER_FACT_FEEDBACK_FACT (fact_type, normalized_fact_value),
        PRIMARY KEY (id)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE = InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_phone_call_events (
        id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
        broker_org_id VARCHAR(120) NOT NULL,
        provider_npi VARCHAR(10) DEFAULT NULL,
        provider_id VARCHAR(191) DEFAULT NULL,
        normalized_phone VARCHAR(30) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX IDX_AI_PROVIDER_PHONE_ORG (broker_org_id),
        INDEX IDX_AI_PROVIDER_PHONE_PROVIDER (provider_npi, provider_id),
        PRIMARY KEY (id)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE = InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_fact_consensus (
        id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
        broker_org_id VARCHAR(120) NOT NULL,
        provider_npi VARCHAR(10) DEFAULT NULL,
        provider_id VARCHAR(191) DEFAULT NULL,
        fact_type VARCHAR(60) NOT NULL,
        normalized_fact_value VARCHAR(255) NOT NULL,
        positive_count INT UNSIGNED DEFAULT 0 NOT NULL,
        negative_count INT UNSIGNED DEFAULT 0 NOT NULL,
        last_validated_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at DATETIME DEFAULT NULL,
        UNIQUE INDEX UNIQ_AI_PROVIDER_FACT_CONSENSUS (
          broker_org_id,
          provider_npi,
          provider_id,
          fact_type,
          normalized_fact_value
        ),
        PRIMARY KEY (id)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE = InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS ai_provider_fact_consensus");
    await queryRunner.query("DROP TABLE IF EXISTS ai_provider_phone_call_events");
    await queryRunner.query("DROP TABLE IF EXISTS ai_provider_fact_feedback");
  }
}
