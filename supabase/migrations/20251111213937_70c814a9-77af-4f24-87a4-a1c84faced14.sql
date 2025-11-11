-- Add ROS and Playoff SOS rank columns to player_pool_v2
ALTER TABLE player_pool_v2 
ADD COLUMN ros_sos_rank integer,
ADD COLUMN playoff_sos_rank integer;