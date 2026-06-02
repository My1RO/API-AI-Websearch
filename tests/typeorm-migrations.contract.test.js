const {
  SafeFeedbackTables2026060200010
} = require("../src/migrations/2026060200010-SafeFeedbackTables");
const {
  DropFeedbackOptionalNote2026060200020
} = require("../src/migrations/2026060200020-DropFeedbackOptionalNote");

const buildQueryRunner = () => ({
  query: jest.fn().mockResolvedValue(undefined),
  hasTable: jest.fn().mockResolvedValue(true),
  hasColumn: jest.fn().mockResolvedValue(false)
});

describe("TypeORM explicit migrations", () => {
  it("creates and drops only the safe PRD-1013 tables", async () => {
    const queryRunner = buildQueryRunner();
    const migration = new SafeFeedbackTables2026060200010();

    await migration.up(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledTimes(3);
    expect(queryRunner.query.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("CREATE TABLE IF NOT EXISTS ai_provider_fact_feedback"),
        expect.stringContaining("CREATE TABLE IF NOT EXISTS ai_provider_phone_call_events"),
        expect.stringContaining("CREATE TABLE IF NOT EXISTS ai_provider_fact_consensus")
      ])
    );
    expect(JSON.stringify(queryRunner.query.mock.calls)).not.toMatch(/optional_note|source_url|prompt|raw_response|quote_id|member_id|client_id/i);

    queryRunner.query.mockClear();
    await migration.down(queryRunner);
    expect(queryRunner.query.mock.calls.map(([sql]) => sql)).toEqual([
      "DROP TABLE IF EXISTS ai_provider_fact_consensus",
      "DROP TABLE IF EXISTS ai_provider_phone_call_events",
      "DROP TABLE IF EXISTS ai_provider_fact_feedback"
    ]);
  });

  it("drops optional_note only when present and can add it back on explicit revert", async () => {
    const queryRunner = buildQueryRunner();
    const migration = new DropFeedbackOptionalNote2026060200020();

    queryRunner.hasColumn.mockResolvedValueOnce(true);
    await migration.up(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith("ALTER TABLE ai_provider_fact_feedback DROP COLUMN optional_note");

    queryRunner.query.mockClear();
    queryRunner.hasColumn.mockResolvedValueOnce(false);
    await migration.down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith(
      "ALTER TABLE ai_provider_fact_feedback ADD COLUMN optional_note VARCHAR(240) DEFAULT NULL"
    );
  });
});
