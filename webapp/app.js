// webapp/app.js
require('dotenv').config();
const express     = require('express');
const bodyParser  = require('body-parser');
const cors        = require('cors');
const sqlite3     = require('sqlite3').verbose();
const path        = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Middleware =====
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Инициализация SQLite =====
const dbFile = path.join(__dirname, 'db', 'wishlist.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Не удалось подключиться к SQLite:', err);
    process.exit(1);
  }
  console.log('Подключились к SQLite:', dbFile);
});

// ===== Создаём таблицы, если их нет =====
// Таблица users: храним Telegram user_id, username
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,      -- это автонумерация SQLite
    telegram_id INTEGER UNIQUE,  -- Telegram User ID
    username TEXT
  )
`);

// Таблица wishlists: у каждого вишлиста есть id, название, автор (telegram_id), is_template (0/1)
db.run(`
  CREATE TABLE IF NOT EXISTS wishlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,   -- владелец списка
    name TEXT,
    is_template INTEGER DEFAULT 0,
    background_url TEXT,   -- URL кастомного фона
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  )
`);

// Таблица items: что в каком вишлисте
db.run(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wishlist_id INTEGER,
    item_index INTEGER,      -- порядковый номер (1,2,3…)
    item_name TEXT,
    rating INTEGER DEFAULT 0,
    comment TEXT DEFAULT '',
    price TEXT DEFAULT '',
    taken INTEGER DEFAULT 0,  -- 0: не взяли, 1: взяли
    url TEXT DEFAULT '',
    FOREIGN KEY (wishlist_id) REFERENCES wishlists(id)
  )
`);

// ===== Вспомогательные функции =====

// 1) Зарегистрировать/обновить пользователя, если его ещё нет
function ensureUser(telegram_id, username) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?, ?)`,
      [telegram_id, username],
      function(err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// 2) Создать новый вишлист (от пользователя), возвращаем ID
function createWishlist(telegram_id, name, is_template = 0, background_url = '') {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO wishlists (telegram_id, name, is_template, background_url) VALUES (?, ?, ?, ?)`,
      [telegram_id, name, is_template, background_url],
      function(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

// 3) Получить все вишлисты данного пользователя (не шаблоны)
function getUserWishlists(telegram_id) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, name, background_url FROM wishlists WHERE telegram_id = ? AND is_template = 0`,
      [telegram_id],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

// 4) Получить детали одного вишлиста вместе с его товарами
function getWishlistWithItems(wishlist_id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, telegram_id, name, is_template, background_url FROM wishlists WHERE id = ?`,
      [wishlist_id],
      (err, wl) => {
        if (err) return reject(err);
        if (!wl) return resolve(null);
        db.all(
          `SELECT id, item_index, item_name, rating, comment, price, taken, url 
           FROM items WHERE wishlist_id = ? ORDER BY item_index ASC`,
          [wishlist_id],
          (err2, items) => {
            if (err2) return reject(err2);
            wl.items = items || [];
            resolve(wl);
          }
        );
      }
    );
  });
}

// 5) Скопировать шаблонный вишлист в личный (создать новый wishlist + его items)
async function copyTemplate(template_wl_id, new_owner_id) {
  const tpl = await getWishlistWithItems(template_wl_id);
  if (!tpl) throw new Error("Шаблон не найден");
  // Создаём новый вишлист
  const newName = `[Копия] ${tpl.name}`;
  const newId = await createWishlist(new_owner_id, newName, 0, tpl.background_url);
  // Копируем все элементы (оставляем тот же rating = 0, taken=0)
  const insertItem = db.prepare(`
    INSERT INTO items 
    (wishlist_id, item_index, item_name, rating, comment, price, taken, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  tpl.items.forEach(it => {
    insertItem.run(newId, it.item_index, it.item_name, 0, "", it.price, 0, it.url);
  });
  insertItem.finalize();
  return newId;
}

// 6) Добавить новый элемент в конкретный вишлист (вызывается из Chat-бота, при пересланном сообщении)
function addItemToWishlist(wishlist_id, item_name, price, url) {
  return new Promise((resolve, reject) => {
    // Сначала узнаём последний item_index (если нет − 0)
    db.get(
      `SELECT MAX(item_index) AS maxIndex FROM items WHERE wishlist_id = ?`,
      [wishlist_id],
      (err, row) => {
        if (err) return reject(err);
        const nextIndex = (row && row.maxIndex ? row.maxIndex : 0) + 1;
        db.run(
          `INSERT INTO items 
            (wishlist_id, item_index, item_name, price, url) 
           VALUES (?, ?, ?, ?, ?)`,
          [wishlist_id, nextIndex, item_name, price, url],
          function(err2) {
            if (err2) return reject(err2);
            resolve(this.lastID);
          }
        );
      }
    );
  });
}

// ====== API-Эндпоинты =====

// 1) Проверка работоспособности
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, msg: 'WebApp живой' });
});

// 2) Добавить item (вызывается Chat-ботом при пересланном сообщении)
//    JSON тело { telegram_user_id, telegram_username, item_name, item_price, item_url }
//    Мы предполагаем, что у пользователя уже есть один активный вишлист, или
//    мы создаём вишлист «По умолчанию» под его ID, если его нет.
app.post('/api/add_item', async (req, res) => {
  try {
    const { telegram_user_id, telegram_username, item_name, item_price, item_url } = req.body;
    if (!telegram_user_id || !item_name) {
      return res.status(400).json({ error: 'Неверные данные' });
    }
    // 2.1) Добавляем/обновляем пользователя
    await ensureUser(telegram_user_id, telegram_username || '');

    // 2.2) Проверяем, есть ли у него «активный» вишлист с названием «Мой первый вишлист» (пример).
    //      Если нет, создаём его. (На будущее можно дать API, чтобы пользователь мог выбирать или
    //      создать новый вишлист через фронтенд).
    const defaultName = "Мой первый Вишлист";
    let wlRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM wishlists WHERE telegram_id = ? AND name = ?`,
        [telegram_user_id, defaultName],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    let wishlist_id;
    if (!wlRow) {
      wishlist_id = await createWishlist(telegram_user_id, defaultName, 0, "");
    } else {
      wishlist_id = wlRow.id;
    }

    // 2.3) Добавляем элемент
    const newItemID = await addItemToWishlist(wishlist_id, item_name, item_price || "", item_url || "");
    return res.json({ ok: true, item_id: newItemID, wishlist_id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// 3) Создать новый вишлист (отрисовывается на фронтенде; POST /api/create_wishlist)
//    JSON тело { telegram_user_id, name, is_template (0 или 1), background_url }
app.post('/api/create_wishlist', async (req, res) => {
  try {
    const { telegram_user_id, telegram_username, name, is_template, background_url } = req.body;
    if (!telegram_user_id || !name) {
      return res.status(400).json({ error: 'telegram_user_id и имя обязательны' });
    }
    await ensureUser(telegram_user_id, telegram_username || '');
    const newID = await createWishlist(telegram_user_id, name, is_template || 0, background_url || "");
    return res.json({ ok: true, wishlist_id: newID });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// 4) Получить список всех своих вишлистов (GET /api/my_wishlists?telegram_user_id=...)
app.get('/api/my_wishlists', async (req, res) => {
  try {
    const telegram_user_id = parseInt(req.query.telegram_user_id);
    if (!telegram_user_id) return res.status(400).json({ error: 'Неверный telegram_user_id' });
    // Убедимся, что пользователь есть (иначе создадим, но можно и опустить)
    await ensureUser(telegram_user_id, '');
    const wls = await getUserWishlists(telegram_user_id);
    return res.json({ ok: true, wishlists: wls });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// 5) Получить один вишлист + его товары (GET /api/get_wishlist/:id)
app.get('/api/get_wishlist/:id', async (req, res) => {
  try {
    const wl_id = parseInt(req.params.id);
    const wl = await getWishlistWithItems(wl_id);
    if (!wl) return res.status(404).json({ error: 'Вишлист не найден' });
    return res.json({ ok: true, wishlist: wl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// 6) Обновить элемент (например, rating, comment, taken) (PUT /api/update_item/:item_id)
app.put('/api/update_item/:item_id', (req, res) => {
  const item_id = parseInt(req.params.item_id);
  const { rating, comment, taken } = req.body;
  // Например, можно обновить любую комбинацию полей:
  db.run(
    `UPDATE items SET rating = COALESCE(?, rating),
                       comment = COALESCE(?, comment),
                       taken   = COALESCE(?, taken)
     WHERE id = ?`,
    [rating, comment, taken, item_id],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Ошибка при обновлении элемента' });
      }
      return res.json({ ok: true, changes: this.changes });
    }
  );
});

// 7) Получить список всех шаблонных вишлистов (GET /api/templates)
app.get('/api/templates', (req, res) => {
  db.all(
    `SELECT w.id, w.name, w.background_url, 
            COUNT(i.id) AS items_count,
            AVG(i.rating) AS avg_rating
     FROM wishlists w
     LEFT JOIN items i ON i.wishlist_id = w.id
     WHERE w.is_template = 1
     GROUP BY w.id
     ORDER BY avg_rating DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Ошибка при получении шаблонов' });
      }
      return res.json({ ok: true, templates: rows });
    }
  );
});

// 8) Скопировать шаблон (POST /api/copy_template) { telegram_user_id, template_id }
app.post('/api/copy_template', async (req, res) => {
  try {
    const { telegram_user_id, telegram_username, template_id } = req.body;
    if (!telegram_user_id || !template_id) return res.status(400).json({ error: 'Неверные данные' });
    await ensureUser(telegram_user_id, telegram_username || '');
    const newId = await copyTemplate(template_id, telegram_user_id);
    return res.json({ ok: true, new_wishlist_id: newId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Не удалось скопировать шаблон' });
  }
});

// ====== Запуск сервера =====
app.listen(PORT, () => {
  console.log(`WebApp запущен: http://localhost:${PORT}`);
});
