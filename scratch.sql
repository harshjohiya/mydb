CREATE TABLE users (id INT, name VARCHAR(100), age INT);
INSERT INTO users VALUES (1, 'Rahul', 22);
INSERT INTO users VALUES (2, 'Priya', 25);
SELECT * FROM users;
BEGIN;
INSERT INTO users VALUES (3, 'Test', 99);
ROLLBACK;
SELECT * FROM users;
EXIT;
