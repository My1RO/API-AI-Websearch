const {
  SafeFeedbackTables2026060200010
} = require("../src/migrations/2026060200010-SafeFeedbackTables");

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
        expect.stringContaining("CREATE TABLE IF NOT EXISTS ai_provider_fact_feedback_counts"),
        expect.stringContaining("CREATE TABLE IF NOT EXISTS ai_provider_phone_call_counts"),
        expect.stringContaining("CREATE TABLE IF NOT EXISTS ai_provider_fact_consensus")
      ])
    );
    const migrationSql = JSON.stringify(queryRunner.query.mock.calls);
    expect(migrationSql).toMatch(/submitter_class/);
    expect(migrationSql).toMatch(/broker_org_id, submitter_class/);
    expect(migrationSql).toMatch(/reason_code VARCHAR\(80\) NOT NULL/);
    expect(migrationSql).toMatch(/feedback_count INT UNSIGNED/);
    expect(migrationSql).toMatch(/click_count INT UNSIGNED/);
    expect(migrationSql).toMatch(/feedback_day DATE NOT NULL/);
    expect(migrationSql).toMatch(/click_day DATE NOT NULL/);
    expect(migrationSql).not.toMatch(/created_at|updated_at|last_validated_at/);
    expect(migrationSql).not.toMatch(/optional_note|source_url|prompt|raw_response|quote_id|member_id|client_id|user_id|session_id|query_id|job_id|request_id/i);

    queryRunner.query.mockClear();
    await migration.down(queryRunner);
    expect(queryRunner.query.mock.calls.map(([sql]) => sql)).toEqual([
      "DROP TABLE IF EXISTS ai_provider_fact_consensus",
      "DROP TABLE IF EXISTS ai_provider_phone_call_counts",
      "DROP TABLE IF EXISTS ai_provider_fact_feedback_counts"
    ]);
  });

});
