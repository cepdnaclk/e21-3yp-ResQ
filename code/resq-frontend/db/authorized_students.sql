-- Create the table that controls which students are allowed to log in.
CREATE TABLE IF NOT EXISTS authorized_students (
  id BIGSERIAL PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helps case-insensitive lookups by email during login.
CREATE INDEX IF NOT EXISTS idx_authorized_students_email_lower
  ON authorized_students (LOWER(email));

-- Optional seed data. Replace with your real authorized students.
INSERT INTO authorized_students (student_id, email, full_name, is_active)
VALUES
  ('EG/2020/0001', 'student1@university.edu', 'Student One', TRUE),
  ('EG/2020/0002', 'student2@university.edu', 'Student Two', TRUE),
  ('EG/2020/0005', 'student3@university.edu', 'Student Three', TRUE)
ON CONFLICT (student_id)
DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
