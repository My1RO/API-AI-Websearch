import { MigrationInterface, QueryRunner } from "typeorm";

const feedbackTable = "ai_provider_fact_feedback";
const optionalNoteColumn = "optional_note";

export class DropFeedbackOptionalNote2026060200020 implements MigrationInterface {
  name = "DropFeedbackOptionalNote2026060200020";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasOptionalNoteColumn(queryRunner)) {
      await queryRunner.query(`ALTER TABLE ${feedbackTable} DROP COLUMN ${optionalNoteColumn}`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if ((await queryRunner.hasTable(feedbackTable)) && !(await queryRunner.hasColumn(feedbackTable, optionalNoteColumn))) {
      await queryRunner.query(`ALTER TABLE ${feedbackTable} ADD COLUMN ${optionalNoteColumn} VARCHAR(240) DEFAULT NULL`);
    }
  }

  private async hasOptionalNoteColumn(queryRunner: QueryRunner): Promise<boolean> {
    if (!(await queryRunner.hasTable(feedbackTable))) {
      return false;
    }

    return queryRunner.hasColumn(feedbackTable, optionalNoteColumn);
  }
}
