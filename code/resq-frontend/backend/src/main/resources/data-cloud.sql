INSERT INTO authorized_students (student_id, email, full_name, is_active)
VALUES
  ('EG/2020/0001', 'student1@university.edu', 'Student One', TRUE),
  ('EG/2020/0002', 'student2@university.edu', 'Student Two', TRUE),
  ('EG/2020/0005', 'student3@university.edu', 'Student Three', TRUE)
ON CONFLICT (student_id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO manikins (manikin_id, manikin_name, connection_status, battery_level, is_active)
VALUES
  ('manikin-01', 'Manikin Alpha', 'online', 87, TRUE),
  ('manikin-02', 'Manikin Bravo', 'online', 64, TRUE),
  ('manikin-03', 'Manikin Charlie', 'online', 92, TRUE),
  ('manikin-04', 'Manikin Delta', 'degraded', 38, TRUE)
ON CONFLICT (manikin_id) DO UPDATE SET
  manikin_name = EXCLUDED.manikin_name,
  connection_status = EXCLUDED.connection_status,
  battery_level = EXCLUDED.battery_level,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

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
  ('manikin-01', NOW(), 52, 110, TRUE, 1, 87, 'online', 'On target'),
  ('manikin-02', NOW(), 47, 103, FALSE, 3, 64, 'online', 'Depth low,Recoil lag'),
  ('manikin-03', NOW(), 55, 114, TRUE, 0, 92, 'online', 'Stable'),
  ('manikin-04', NOW(), 49, 98, FALSE, 2, 38, 'degraded', 'Battery low');
