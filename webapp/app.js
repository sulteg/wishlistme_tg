// app.js
// ───────────────────────────────────────────────────────────────────────────
// Express-сервер для Wishlist-MiniApp:
//   • Telegram Login (GET /auth/telegram?…) → проверка подписи → redirect на SPA
//   • CRUD для вишлистов (/api/...)
//   • Статика: отдаёт public/index.html и public/app.html + всё, что лежит в public/static
// ───────────────────────────────────────────────────────────────────────────

const path = require("path");
const express = require("express");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config(); // чтобы читать .env, если вы используете локально

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ──────────────────────────────────────────────────────────────────
// ПАРАМЕТРЫ И ПОДКЛЮЧЕНИЕ К БАЗЕ
// ──────────────────────────────────────────────────────────────────

// Путь к файлу SQLite
const dbPath = path.join(__dirname, "db", "wishlist.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Не удалось подключиться к SQLite:", err.message);
    process.exit(1);
  }
  console.log("SQLite подключён к:", dbPath);
});

// Создаем таблицы, если они не существуют
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      username TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wishlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_template INTEGER DEFAULT 0,
      background TEXT,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wishlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wishlist_id INTEGER NOT NULL,
      ordinal INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      desired_level INTEGER DEFAULT 0,
      comment TEXT,
      price REAL DEFAULT 0,
      url TEXT,
      taken INTEGER DEFAULT 0,
      FOREIGN KEY(wishlist_id) REFERENCES wishlists(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS template_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      FOREIGN KEY(template_id) REFERENCES wishlists(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
});

// ──────────────────────────────────────────────────────────────────
// Telegram Login: проверяем подпись и сохраняем пользователя
// ──────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN не задан в окружении. Выходим.");
  process.exit(1);
}

// Secret для проверки подписи: HMAC-SHA256 от BOT_TOKEN
const SECRET = crypto
  .createHash("sha256")
  .update(BOT_TOKEN)
  .digest();

function validateTelegramAuth(data) {
  // data = { id, first_name, username, auth_date, hash, … }
  const { hash, ...rest } = data;

  // Формируем строку «ключ=значение\nключ=значение…» в лексикографическом порядке ключей
  const dataCheckList = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("\n");

  // HMAC-SHA256 по SECRET
  const hmac = crypto
    .createHmac("sha256", SECRET)
    .update(dataCheckList)
    .digest("hex");

  return hmac === hash;
}

app.get("/auth/telegram", (req, res) => {
  const telegramData = req.query; // { id, first_name, username, auth_date, hash, … }

  if (!validateTelegramAuth(telegramData)) {
    return res.status(401).send("Ошибка авторизации Telegram");
  }

  const tg_id = telegramData.id;
  const first_name = telegramData.first_name || "";
  const last_name = telegramData.last_name || "";
  const username = telegramData.username || "";

  // Сохраняем (INSERT OR IGNORE) пользователя в таблицу users
  db.run(
    `
    INSERT OR IGNORE INTO users (telegram_id, first_name, last_name, username)
    VALUES (?, ?, ?, ?)
  `,
    [tg_id, first_name, last_name, username],
    (err) => {
      if (err) {
        console.error("Ошибка сохранения пользователя:", err.message);
        return res.status(500).send("Ошибка сервера при авторизации");
      }

      // После сохранения/обновления перенаправляем на SPA
      return res.redirect(`/app.html?user_id=${tg_id}`);
    }
  );
});

// ──────────────────────────────────────────────────────────────────
// CRUD: основные эндпоинты для вишлистов и товаров
// ──────────────────────────────────────────────────────────────────

// 1) GET /api/wishlists?user_id=…  — получить список вишлистов (user = owner_id)
app.get("/api/wishlists", (req, res) => {
  const user_id = parseInt(req.query.user_id);
  if (!user_id) {
    return res.status(400).json({ error: "user_id обязателен" });
  }

  db.all(
    `SELECT * FROM wishlists
     WHERE owner_id = ? AND is_template = 0
     ORDER BY created_at DESC`,
    [user_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 2) POST /api/wishlists  — создать новый вишлист
app.post("/api/wishlists", (req, res) => {
  const { user_id, title, background } = req.body;
  if (!user_id || !title) {
    return res
      .status(400)
      .json({ error: "user_id и title обязательны для создания" });
  }

  db.run(
    `INSERT INTO wishlists (owner_id, title, background) VALUES (?, ?, ?)`,
    [user_id, title, background || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, wishlist_id: this.lastID });
    }
  );
});

// 3) GET /api/wishlist/:wid/items — получить все товары в конкретном вишлисте
app.get("/api/wishlist/:wid/items", (req, res) => {
  const wid = parseInt(req.params.wid);
  if (!wid) {
    return res.status(400).json({ error: "wid обязателен" });
  }

  db.all(
    `SELECT * FROM wishlist_items WHERE wishlist_id = ? ORDER BY ordinal ASC`,
    [wid],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 4) POST /api/wishlist/:wid/item — добавить новый товар
app.post("/api/wishlist/:wid/item", (req, res) => {
  const wid = parseInt(req.params.wid);
  const {
    ordinal,
    name,
    desired_level,
    comment,
    price,
    url,
    taken,
  } = req.body;

  if (!wid || !name) {
    return res
      .status(400)
      .json({ error: "wid и name обязательны для добавления товара" });
  }

  db.run(
    `
    INSERT INTO wishlist_items
      (wishlist_id, ordinal, name, desired_level, comment, price, url, taken)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      wid,
      ordinal || 0,
      name,
      desired_level || 0,
      comment || null,
      price || 0,
      url || null,
      taken || 0,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, item_id: this.lastID });
    }
  );
});

// 5) PUT /api/wishlist/:wid/item/:item_id — обновить/отметить товар
app.put("/api/wishlist/:wid/item/:item_id", (req, res) => {
  const item_id = parseInt(req.params.item_id);
  const { ordinal, name, desired_level, comment, price, url, taken } = req.body;

  if (!item_id) {
    return res.status(400).json({ error: "item_id обязателен" });
  }

  db.run(
    `
    UPDATE wishlist_items
    SET
      ordinal = COALESCE(?, ordinal),
      name = COALESCE(?, name),
      desired_level = COALESCE(?, desired_level),
      comment = COALESCE(?, comment),
      price = COALESCE(?, price),
      url = COALESCE(?, url),
      taken = COALESCE(?, taken)
    WHERE id = ?
  `,
    [
      ordinal,
      name,
      desired_level,
      comment,
      price,
      url,
      taken,
      item_id,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    }
  );
});

// 6) DELETE /api/wishlist/:wid/item/:item_id — удалить товар
app.delete("/api/wishlist/:wid/item/:item_id", (req, res) => {
  const item_id = parseInt(req.params.item_id);
  if (!item_id) {
    return res.status(400).json({ error: "item_id обязателен" });
  }

  db.run(
    `DELETE FROM wishlist_items WHERE id = ?`,
    [item_id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    }
  );
});

// 7) GET /api/templates — список шаблонных вишлистов (с средней оценкой и кол-вом товаров)
app.get("/api/templates", (req, res) => {
  const sql = `
    SELECT 
      w.id, w.title, w.background,
      COUNT(i.id) AS items_count,
      COALESCE(AVG(r.rating), 0) AS avg_rating
    FROM wishlists w
    LEFT JOIN wishlist_items i ON i.wishlist_id = w.id
    LEFT JOIN template_ratings r ON r.template_id = w.id
    WHERE w.is_template = 1
    GROUP BY w.id, w.title, w.background
    ORDER BY avg_rating DESC, items_count DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 8) POST /api/templates/:tid/rate — поставить рейтинг шаблонному вишлисту
app.post("/api/templates/:tid/rate", (req, res) => {
  const tid = parseInt(req.params.tid);
  const { user_id, rating } = req.body;

  if (!tid || !user_id || !rating) {
    return res
      .status(400)
      .json({ error: "tid, user_id и rating обязательны" });
  }

  // Сначала пробуем обновить, если запись уже есть:
  db.run(
    `
    UPDATE template_ratings
    SET rating = ?
    WHERE template_id = ? AND user_id = ?
  `,
    [rating, tid, user_id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      if (this.changes === 0) {
        // Если не было записи — вставляем новую
        db.run(
          `
          INSERT INTO template_ratings (template_id, user_id, rating)
          VALUES (?, ?, ?)
        `,
          [tid, user_id, rating],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true, rating_id: this.lastID });
          }
        );
      } else {
        // Обновили существующую
        res.json({ success: true, message: "Рейтинг обновлён" });
      }
    }
  );
});

// 9) POST /api/templates/:tid/copy — скопировать шаблонный вишлист себе
app.post("/api/templates/:tid/copy", (req, res) => {
  const tid = parseInt(req.params.tid);
  const { user_id } = req.body;

  if (!tid || !user_id) {
    return res.status(400).json({ error: "tid и user_id обязательны" });
  }

  // 1) Получаем шаблон
  db.get(
    `SELECT title, background FROM wishlists WHERE id = ? AND is_template = 1`,
    [tid],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Шаблон не найден" });

      const { title, background } = row;

      // 2) Создаём новый вишлист от текущего пользователя
      db.run(
        `INSERT INTO wishlists (owner_id, title, background) VALUES (?, ?, ?)`,
        [user_id, title, background],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          const newWishlistId = this.lastID;

          // 3) Копируем все товары из шаблона
          db.all(
            `SELECT ordinal, name, desired_level, comment, price, url, taken 
             FROM wishlist_items 
             WHERE wishlist_id = ?`,
            [tid],
            (err3, items) => {
              if (err3) return res.status(500).json({ error: err3.message });

              if (!items.length) {
                return res.json({
                  success: true,
                  wishlist_id: newWishlistId,
                  copied_items: 0,
                });
              }

              const placeholders = items
                .map(() => "(?, ?, ?, ?, ?, ?, ?, ?)")
                .join(", ");

              const values = [];
              items.forEach((it) => {
                values.push(
                  newWishlistId,
                  it.ordinal,
                  it.name,
                  it.desired_level,
                  it.comment,
                  it.price,
                  it.url,
                  it.taken
                );
              });

              db.run(
                `
                INSERT INTO wishlist_items
                  (wishlist_id, ordinal, name, desired_level, comment, price, url, taken)
                VALUES 
                  ${placeholders}
              `,
                values,
                function (err4) {
                  if (err4) return res.status(500).json({ error: err4.message });
                  res.json({
                    success: true,
                    wishlist_id: newWishlistId,
                    copied_items: items.length,
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// ──────────────────────────────────────────────────────────────────
//   Раздача статических файлов (frontend)
// ──────────────────────────────────────────────────────────────────

// Отдаём public/index.html (с Telegram Login Widget), public/app.html (React/Vue SPA),
// а также всё из public/static (js/css/etc).
app.use(express.static(path.join(__dirname, "public")));

// Если нужно, можно 
// app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ──────────────────────────────────────────────────────────────────
//   Запуск сервера
// ──────────────────────────────────────────────────────────────────

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`WebApp запущен: http://0.0.0.0:${port}`);
});
