-- 037_side_stage_reads_check_ins.sql
-- Found in the second mock feis: side-stage showed every dancer as
-- "Not arrived · No number" because event_check_ins was readable only by the
-- organizer and registration desk. Side-stage needs arrivals to spot dancers
-- who picked up a number but haven't come to the stage.

CREATE POLICY event_check_ins_select_side_stage ON event_check_ins FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM event_roles er
    WHERE er.event_id = event_check_ins.event_id
      AND er.user_id = auth.uid()
      AND er.role = 'side_stage'
  ));
