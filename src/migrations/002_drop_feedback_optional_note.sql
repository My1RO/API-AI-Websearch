SET @drop_feedback_optional_note = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'ai_provider_fact_feedback'
        AND column_name = 'optional_note'
    ),
    'ALTER TABLE ai_provider_fact_feedback DROP COLUMN optional_note',
    'SELECT 1'
  )
);

PREPARE drop_feedback_optional_note_stmt FROM @drop_feedback_optional_note;
EXECUTE drop_feedback_optional_note_stmt;
DEALLOCATE PREPARE drop_feedback_optional_note_stmt;
