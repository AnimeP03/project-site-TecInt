-- GameHub Database Schema
-- Combined migration file for all tables and constraints

-- users table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `username` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_UNIQUE` (`email`),
  UNIQUE KEY `username_UNIQUE` (`username`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- games table
CREATE TABLE IF NOT EXISTS `games` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `min_players` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `max_players` TINYINT UNSIGNED NOT NULL DEFAULT 2,
  `icon` varchar(45) DEFAULT NULL,
  `description` text NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name_UNIQUE` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lobbies table
CREATE TABLE IF NOT EXISTS `lobbies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `game_id` INT UNSIGNED NOT NULL,
  `host_user_id` INT UNSIGNED NOT NULL,
  `status` ENUM('Open','Playing') DEFAULT 'Open',
  `max_players` TINYINT UNSIGNED DEFAULT 2,
  `is_private` TINYINT(1) DEFAULT 0,
  `password` VARCHAR(100) NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_lobbies_game_id`
    FOREIGN KEY (`game_id`) REFERENCES `games` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_lobbies_host_user_id`
    FOREIGN KEY (`host_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lobby_members table
CREATE TABLE IF NOT EXISTS `lobby_members` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lobby_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `peer_id` VARCHAR(255) NULL,
  `joined_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `is_ready` TINYINT(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_lobby_members_lobby_id`
    FOREIGN KEY (`lobby_id`) REFERENCES `lobbies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lobby_members_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- user_game_stats table (tracks wins/losses per game)
CREATE TABLE IF NOT EXISTS `user_game_stats` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `game_id` INT UNSIGNED NOT NULL,
  `wins` INT UNSIGNED DEFAULT 0,
  `losses` INT UNSIGNED DEFAULT 0,
  `draw` INT UNSIGNED DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_game` (`user_id`, `game_id`),
  CONSTRAINT `fk_user_game_stats_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_game_stats_game_id`
    FOREIGN KEY (`game_id`) REFERENCES `games` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sample data for games
INSERT INTO games (name, min_players, max_players, icon, description) VALUES
('Tris', 2, 2, '❌', 'Classic Tic-Tac-Toe (1v1).'),
('Connect4', 2, 2, '🟡', 'Connect 4 (1v1).'),
('Sasso Carta Forbici', 2, 2, '✂️', 'Rock-Paper-Scissors, best of 3.'),
('Indovina il numero', 2, 4, '🔢', 'Guess the secret number (turn-based).');