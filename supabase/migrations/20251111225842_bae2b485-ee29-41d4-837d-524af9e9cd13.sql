-- Add ranking columns to strength_of_schedule table
ALTER TABLE strength_of_schedule 
ADD COLUMN IF NOT EXISTS ros_sos_rank integer,
ADD COLUMN IF NOT EXISTS playoff_sos_rank integer;