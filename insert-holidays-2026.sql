-- Insert 2026 holidays into holiday_master table
-- Run this SQL in your MySQL database

INSERT INTO holiday_master (name, date, type, is_optional, description, is_active) VALUES
('New Year', '2026-01-01', 'national', FALSE, 'New Year is the time or day at which a new calendar year begins.', TRUE),
('Republic Day of India', '2026-01-26', 'national', FALSE, 'Republic Day honours the date on which the Constitution of India came into effect on 26 January 1950.', TRUE),
('Holi - Rang Panchami', '2026-03-03', 'religious', FALSE, 'Holi is a Hindu spring festival, originating from the Indian subcontinent.', TRUE),
('Gudhi Padwa', '2026-03-19', 'religious', FALSE, 'The Gudhi is said to represent the flag of Brahma as mentioned in the Brahma Purana.', TRUE),
('Ramzan ID', '2026-03-21', 'religious', FALSE, 'Ramzan is a sacred time of the year for millions of Muslims all over the world.', TRUE),
('Maharashtra Day', '2026-05-01', 'regional', FALSE, 'Maharashtra Day commemorating the formation of the state of Maharashtra.', TRUE),
('Independence Day', '2026-08-15', 'national', FALSE, 'Independence Day is celebrated on 15 August as a national holiday in India.', TRUE),
('Ganesh Chaturthi', '2026-09-14', 'religious', FALSE, 'Ganesh Chaturthi is a Hindu festival celebrating the birth of Lord Ganesha.', TRUE),
('Anant Chaturdashi', '2026-09-25', 'religious', TRUE, 'Anant Chaturdashi - Half Day 8:00 am to 1:30 pm.', TRUE),
('Gandhi Jayanti', '2026-10-02', 'national', FALSE, 'Gandhi Jayanti is a national festival celebrating the birth anniversary of Mahatma Gandhi.', TRUE),
('Dussehra', '2026-10-20', 'religious', FALSE, 'Vijayadashami celebrations include processions to a river or ocean front.', TRUE),
('Deepawali', '2026-11-08', 'religious', FALSE, 'Diwali is the Hindu festival of lights.', TRUE),
('Deepawali (Day 2)', '2026-11-11', 'religious', FALSE, 'Second day of Diwali celebrations.', TRUE),
('Christmas', '2026-12-25', 'religious', FALSE, 'Christmas commemorates the birth of Jesus Christ.', TRUE)
ON DUPLICATE KEY UPDATE 
  type = VALUES(type),
  is_optional = VALUES(is_optional),
  description = VALUES(description),
  is_active = VALUES(is_active);
