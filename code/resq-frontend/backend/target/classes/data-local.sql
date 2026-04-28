INSERT INTO authorized_students (student_id, email, full_name, is_active)
VALUES
  ('EG/2020/0001', 'student1@university.edu', 'Student One', 1),
  ('EG/2020/0002', 'student2@university.edu', 'Student Two', 1),
  ('EG/2020/0005', 'student3@university.edu', 'Student Three', 1)
ON CONFLICT(student_id) DO UPDATE SET
  email = excluded.email,
  full_name = excluded.full_name,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO manikins (manikin_id, manikin_name, connection_status, battery_level, is_active)
VALUES
  ('manikin-01', 'Manikin Alpha', 'online', 87, 1),
  ('manikin-02', 'Manikin Bravo', 'online', 64, 1),
  ('manikin-03', 'Manikin Charlie', 'online', 92, 1),
  ('manikin-04', 'Manikin Delta', 'degraded', 38, 1)
ON CONFLICT(manikin_id) DO UPDATE SET
  manikin_name = excluded.manikin_name,
  connection_status = excluded.connection_status,
  battery_level = excluded.battery_level,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO manikin_telemetry_samples (
  manikin_id,
  recorded_at,
  depth_mm,
  rate_cpm,
  recoil_ok,
  pauses,
  battery_level,
  connection_status,
  flags
)
VALUES
  ('manikin-01', CURRENT_TIMESTAMP, 52, 110, 1, 1, 87, 'online', 'On target'),
  ('manikin-02', CURRENT_TIMESTAMP, 47, 103, 0, 3, 64, 'online', 'Depth low,Recoil lag'),
  ('manikin-03', CURRENT_TIMESTAMP, 55, 114, 1, 0, 92, 'online', 'Stable'),
  ('manikin-04', CURRENT_TIMESTAMP, 49, 98, 0, 2, 38, 'degraded', 'Battery low');
