// public/app.js

// ====== Глобальные переменные и state ======
const telegram = window.Telegram.WebApp;  
// Объект Telegram WebApp позволяет получать user.id, user.username и сверять, кто зашёл.

const apiBase = ''; // в локальном режиме «apiBase = ''», т.к. фронтенд и бэкенд на одном порту

let currentUser = null;       // Объект {id:…, username:…}
let currentWishlistId = null; // ID вишлиста, который сейчас открыт

// ====== Утилиты ======

// 1) Fetch-обёртка: GET
async function getJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Ошибка GET ${url}: ${resp.status}`);
  return await resp.json();
}

// 2) Fetch-обёртка: POST
async function postJSON(url, data) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(data)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ошибка POST ${url}: ${resp.status} — ${text}`);
  }
  return await resp.json();
}

// 3) Fetch-обёртка: PUT
async function putJSON(url, data) {
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(data)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ошибка PUT ${url}: ${resp.status} — ${text}`);
  }
  return await resp.json();
}

// 4) Helper: скрыть/показать секцию
function showSection(id) {
  document.querySelectorAll('section').forEach(sec => sec.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

/*****************************************************************
 *           5. Основная логика работы MiniApp (порядок)         *
 *****************************************************************/

async function initialize() {
  // 1) При инициализации MiniApp получаем user из Telegram WebApp:
  currentUser = {
    id: telegram.initDataUnsafe.user.id,         // Telegram User ID
    username: telegram.initDataUnsafe.user.username || ''
  };

  // 2) Показываем раздел «Ваши вишлисты»
  await loadMyWishlists();
  showSection('my-lists-section');
}

// ====== 5.1. Загрузка списка вишлистов пользователя ======

async function loadMyWishlists() {
  const ul = document.getElementById('my-lists-list');
  ul.innerHTML = '<li>Загрузка…</li>';
  try {
    const data = await getJSON(`/api/my_wishlists?telegram_user_id=${currentUser.id}`);
    if (!data.ok) throw new Error('Не получилось получить вишлисты');
    ul.innerHTML = ''; // очистили
    if (data.wishlists.length === 0) {
      ul.innerHTML = '<li>У вас пока нет вишлистов.</li>';
    } else {
      data.wishlists.forEach(wl => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span>${wl.name} (ID: ${wl.id})</span>
          <button data-id="${wl.id}">Открыть</button>
        `;
        // Когда нажали «Открыть», загружаем содержимое:
        li.querySelector('button').addEventListener('click', () => openWishlist(wl.id));
        ul.appendChild(li);
      });
    }
  } catch(err) {
    console.error(err);
    ul.innerHTML = `<li>Ошибка при загрузке.</li>`;
  }
}

// ====== 5.2. Открыть существующий вишлист ======

async function openWishlist(wishlist_id) {
  currentWishlistId = wishlist_id;
  // 1) Получаем данные вишлиста с бэкенда:
  try {
    const data = await getJSON(`/api/get_wishlist/${wishlist_id}`);
    if (!data.ok) throw new Error('Не удалось получить вишлист');
    renderWishlist(data.wishlist);
  } catch(err) {
    console.error(err);
    alert('Ошибка при загрузке вишлиста.');
    return;
  }
  // 2) Показываем редактор вишлиста
  showSection('wishlist-editor');
}

// ====== 5.3. Рендерим вишлист на экране ======

function renderWishlist(wl) {
  // Заголовок
  document.getElementById('editor-title').innerText = `Вишлист: ${wl.name}`;
  // Фон (если задан)
  if (wl.background_url) {
    document.body.style.backgroundImage = `url(${wl.background_url})`;
  } else {
    document.body.style.backgroundImage = `none`;
  }
  // Поле для редактирования названия
  document.getElementById('wl-name').value = wl.name;
  document.getElementById('wl-bg-url').value = wl.background_url || '';

  // Заполняем таблицу items
  const tbody = document.querySelector('#items-table tbody');
  tbody.innerHTML = ''; // очистили

  wl.items.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.item_index}</td>
      <td>${item.item_name}</td>
      <td>${item.price}</td>
      <td>
        <input type="number" data-item-id="${item.id}" class="rating-input" 
               value="${item.rating}" min="0" max="5" style="width:50px;" />
      </td>
      <td>
        <input type="text" data-item-id="${item.id}" class="comment-input"
               value="${item.comment}" placeholder="Комментарий" style="width:100%;" />
      </td>
      <td>
        <input type="checkbox" data-item-id="${item.id}" class="taken-checkbox" 
               ${item.taken ? 'checked' : ''} />
      </td>
      <td>
        ${ item.url ? `<a href="${item.url}" target="_blank">Ссылка</a>` : '' }
      </td>
      <td>
        <button data-item-id="${item.id}" class="btn-delete-item">❌</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Вешаем слушатели на rating, comment, taken и удаление
  document.querySelectorAll('.rating-input').forEach(inp => {
    inp.addEventListener('change', async ev => {
      const id = ev.target.dataset.itemId;
      const newRating = parseInt(ev.target.value) || 0;
      try {
        await putJSON(`/api/update_item/${id}`, { rating: newRating });
      } catch(err) {
        console.error(err);
        alert('Не удалось обновить рейтинг');
      }
    });
  });
  document.querySelectorAll('.comment-input').forEach(inp => {
    inp.addEventListener('change', async ev => {
      const id = ev.target.dataset.itemId;
      const newComment = ev.target.value || '';
      try {
        await putJSON(`/api/update_item/${id}`, { comment: newComment });
      } catch(err) {
        console.error(err);
        alert('Не удалось обновить комментарий');
      }
    });
  });
  document.querySelectorAll('.taken-checkbox').forEach(chk => {
    chk.addEventListener('change', async ev => {
      const id = ev.target.dataset.itemId;
      const takenVal = ev.target.checked ? 1 : 0;
      try {
        await putJSON(`/api/update_item/${id}`, { taken: takenVal });
      } catch(err) {
        console.error(err);
        alert('Не удалось обновить статус «взял»');
      }
    });
  });
  document.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', async ev => {
      const itemId = ev.target.dataset.itemId;
      // Удалим item из DB напрямую (с простым подходом – вызов сервера, 
      // но поскольку пока нет delete-endpoint, просто пометим taken=1 и rating=-1).
      try {
        await putJSON(`/api/update_item/${itemId}`, { taken: 1, rating: -1 });
        openWishlist(currentWishlistId); // обновляем отображение
      } catch(err) {
        console.error(err);
        alert('Не удалось удалить товар (пометить как взятый)');
      }
    });
  });
}

// ====== 5.4. Сохранить/обновить заголовок и фон вишлиста ======

document.getElementById('btnSaveList').addEventListener('click', async () => {
  const newName = document.getElementById('wl-name').value.trim();
  const newBg   = document.getElementById('wl-bg-url').value.trim();

  if (!newName) {
    alert('Название не может быть пустым.');
    return;
  }
  try {
    // В настоящий момент у нас нет специального API для «обновить вишлист»,
    // но вы можете расширить backend, добавив /api/update_wishlist/:id.
    // Для простоты мы будем копировать: создадим новый, а старый удалять не станем.
    // Однако, чтобы обновить существующий, добавьте в app.js:
    //
    // app.put('/api/update_wishlist/:id', (req,res) => {
    //   const { name, background_url } = req.body;
    //   db.run(`UPDATE wishlists SET name = ?, background_url = ? WHERE id = ?`,
    //     [name, background_url, req.params.id], function(err) {
    //       if (err) return res.status(500).json({ error:'Ошибка' });
    //       res.json({ ok:true });
    //     });
    // });
    //
    // И здесь:
    await putJSON(`/api/update_wishlist/${currentWishlistId}`, {
      name: newName,
      background_url: newBg
    });
    alert('Вишлист обновлён.');
    openWishlist(currentWishlistId);
  } catch(err) {
    console.error(err);
    alert('Не удалось сохранить изменения вишлиста.');
  }
});

// ====== 5.5. Добавить товар вручную ======

document.getElementById('btnAddItem').addEventListener('click', async () => {
  const name = document.getElementById('item-name').value.trim();
  const price = document.getElementById('item-price').value.trim();
  const url = document.getElementById('item-url').value.trim();

  if (!name) {
    alert('Название товара обязательно.');
    return;
  }
  try {
    // Здесь у нас тоже нет «официального» end-point add_item (он только из бота),
    // поэтому сделаем временный: POST /api/add_item_manual { wishlist_id, item_name, price, url }
    //
    // Для этого в backend (webapp/app.js) нужно добавить:
    // app.post('/api/add_item_manual', (req,res) => {
    //   const { wishlist_id, item_name, price, url } = req.body;
    //   addItemToWishlist(wishlist_id, item_name, price, url)
    //     .then(id => res.json({ ok:true, item_id:id }))
    //     .catch(err => res.status(500).json({ error:'Ошибка' }));
    // });
    //
    const resp = await postJSON('/api/add_item_manual', {
      wishlist_id: currentWishlistId,
      item_name: name,
      price: price,
      url: url
    });
    if (resp.ok) {
      alert('Товар добавлен.');
      openWishlist(currentWishlistId);
      document.getElementById('item-name').value = '';
      document.getElementById('item-price').value = '';
      document.getElementById('item-url').value = '';
    }
  } catch(err) {
    console.error(err);
    alert('Не удалось добавить товар.');
  }
});

// ====== 5.6. Создать новый вишлист ======

document.getElementById('btnNewList').addEventListener('click', () => {
  // Очищаем поля формы редактора
  currentWishlistId = null;
  document.getElementById('wl-name').value = '';
  document.getElementById('wl-bg-url').value = '';
  document.querySelector('#items-table tbody').innerHTML = '';
  document.getElementById('editor-title').innerText = 'Создать новый вишлист';
  showSection('wishlist-editor');
});

// ====== 5.7. Сохранение нового вишлиста ======

document.getElementById('btnSaveList').addEventListener('click', async () => {
  const name = document.getElementById('wl-name').value.trim();
  const bg = document.getElementById('wl-bg-url').value.trim();
  if (!name) {
    alert('Название вишлиста обязательно.');
    return;
  }
  try {
    // POST /api/create_wishlist { telegram_user_id, telegram_username, name, is_template, background_url }
    const resp = await postJSON('/api/create_wishlist', {
      telegram_user_id: currentUser.id,
      telegram_username: currentUser.username,
      name: name,
      is_template: 0,
      background_url: bg
    });
    if (resp.ok) {
      alert('Вишлист создан.');
      // Загрузим всё заново
      await loadMyWishlists();
      showSection('my-lists-section');
    }
  } catch(err) {
    console.error(err);
    alert('Не удалось создать вишлист.');
  }
});

// ====== 5.8. Раздел «Шаблоны» ======

document.getElementById('btnGallery').addEventListener('click', async () => {
  showSection('templates-section');
  const ul = document.getElementById('templates-list');
  ul.innerHTML = '<li>Загрузка шаблонов…</li>';
  try {
    const data = await getJSON('/api/templates');
    if (!data.ok) throw new Error('Не удалось получить шаблоны');
    ul.innerHTML = '';
    if (data.templates.length === 0) {
      ul.innerHTML = '<li>Пока нет шаблонов.</li>';
    } else {
      data.templates.forEach(tpl => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span>${tpl.name} — ${tpl.items_count} товаров, средний рейтинг ${Math.round(tpl.avg_rating || 0)}</span>
          <button data-id="${tpl.id}" class="btnCopyTemplate">Копировать</button>
        `;
        ul.appendChild(li);
      });
      document.querySelectorAll('.btnCopyTemplate').forEach(btn => {
        btn.addEventListener('click', async ev => {
          const tplId = ev.target.dataset.id;
          try {
            const resp = await postJSON('/api/copy_template', {
              telegram_user_id: currentUser.id,
              telegram_username: currentUser.username,
              template_id: parseInt(tplId)
            });
            if (resp.ok) {
              alert('Шаблон скопирован. Теперь он в ваших вишлистах.');
              await loadMyWishlists();
              showSection('my-lists-section');
            }
          } catch(err) {
            console.error(err);
            alert('Не удалось скопировать шаблон.');
          }
        });
      });
    }
  } catch(err) {
    console.error(err);
    ul.innerHTML = '<li>Ошибка при загрузке шаблонов.</li>';
  }
});

// ====== 5.9. «← Назад» из режима редактирования/шаблонов ======
document.getElementById('btnBackToLists').addEventListener('click', async () => {
  document.body.style.backgroundImage = 'none';
  await loadMyWishlists();
  showSection('my-lists-section');
});
document.getElementById('btnBackFromTemplates').addEventListener('click', async () => {
  await loadMyWishlists();
  showSection('my-lists-section');
});

// ====== Инициализация при запуске страницы ======
window.addEventListener('load', initialize);
