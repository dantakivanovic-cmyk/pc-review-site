const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== КОНФИГУРАЦИЯ ВКОНТАКТЕ =====
const VK_ACCESS_TOKEN = 'vk1.a.yefEUBQ3PV212zraqBeBJL6fqFk2nH1M29GadDYWKPtuzQ8uxVruJyUv0qOryWzozDfEnzXLqLXt2IC91HXQ1zVpUXswBGLKXC5ameEtNyhhxV3iBdPQZkXAhNmjXrbmR5jF2im03rPDxOSzzMiICm90zjijl_T9ep04cT_Z75RqU5s6qnb1lsd19cypKIA5LKcWRqIanzXkpFHqHqbcZg';
const VK_GROUP_ID = 237856528;  // из вашего скриншота
const VK_API_VERSION = '5.199';

// Middleware
app.use(cors());
app.use(express.json());

// ===== БАЗА ДАННЫХ =====
const db = new sqlite3.Database('./orders.db');

db.run(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    build TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    visit_date TEXT NOT NULL,
    UNIQUE(ip, visit_date)
  )
`);

// ===== ФУНКЦИЯ ОТПРАВКИ В ВКОНТАКТЕ =====
async function sendToVK(text) {
    // peer_id с минусом = сообщество (беседа)
    const peerId = 523418464;
    
    const url = `https://api.vk.com/method/messages.send`;
    const params = new URLSearchParams({
        access_token: VK_ACCESS_TOKEN,
        v: VK_API_VERSION,
        peer_id: peerId,
        message: text,
        random_id: Math.floor(Math.random() * 1000000)  // обязательный параметр
    });
    
    try {
        const response = await fetch(`${url}?${params}`);
        const result = await response.json();
        
        if (result.error) {
            console.error('❌ Ошибка ВК API:', result.error);
            return false;
        }
        
        console.log('✅ Сообщение отправлено в ВК, peer_id:', peerId);
        return true;
    } catch (error) {
        console.error('❌ Ошибка сети при отправке в ВК:', error.message);
        return false;
    }
}

// ===== API: ПРИЁМ ЗАЯВКИ =====
app.post('/api/submit-order', async (req, res) => {
    const { name, phone, email, build, message } = req.body;
    
    // Валидация
    if (!name || !phone) {
        return res.status(400).json({ 
            success: false, 
            error: 'Имя и телефон обязательны для заполнения' 
        });
    }
    
    // Сохраняем в БД
    db.run(
        `INSERT INTO orders (name, phone, email, build, message) VALUES (?, ?, ?, ?, ?)`,
        [name, phone, email || '', build || '', message || ''],
        function(err) {
            if (err) {
                console.error('❌ Ошибка БД:', err);
                return;
            }
            console.log(`✅ Заявка №${this.lastID} сохранена в БД`);
        }
    );
    
    // Формируем красивое сообщение для ВК
    const vkMessage = `
📦 НОВАЯ ЗАЯВКА С САЙТА

👤 Имя: ${name}
📞 Телефон: ${phone}
📧 Email: ${email || 'не указан'}
💻 Сборка: ${build || 'не указана'}

📝 Сообщение:
${message || '—'}

🕐 Время: ${new Date().toLocaleString('ru-RU')}
    `;
    
    // Отправляем в ВК
    const sent = await sendToVK(vkMessage);
    
    if (sent) {
        res.json({ 
            success: true, 
            message: 'Заявка успешно отправлена!' 
        });
    } else {
        res.status(500).json({ 
            success: false, 
            error: 'Не удалось отправить уведомление, но заявка сохранена' 
        });
    }
});

// ===== API: ПОЛУЧИТЬ ВСЕ ЗАЯВКИ (для админа) =====
app.get('/api/orders', (req, res) => {
    db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// ===== API: СТАТИСТИКА =====
app.get('/api/stats', (req, res) => {
    db.get('SELECT COUNT(*) as total FROM orders', (err, totalRow) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get(
            "SELECT COUNT(*) as today FROM orders WHERE DATE(created_at) = DATE('now')",
            (err, todayRow) => {
                if (err) return res.status(500).json({ error: err.message });
                
                res.json({
                    total: totalRow.total,
                    today: todayRow.today
                });
            }
        );
    });
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        vk_group_id: VK_GROUP_ID
    });
});

// ===== КОРНЕВОЙ ПУТЬ =====
app.get('/', (req, res) => {
    res.json({
        name: 'PC Review Backend (VK version)',
        version: '1.0.0',
        endpoints: {
            'POST /api/submit-order': 'Отправить заявку (в ВК)',
            'GET /api/orders': 'Получить все заявки',
            'GET /api/stats': 'Статистика',
            'GET /health': 'Проверка состояния'
        }
    });
});
// API: получить количество уникальных посетителей за сегодня
app.get('/api/visitors/today', (req, res) => {
    const today = new Date().toISOString().split('T')[0]; // '2026-04-20'
    
    db.get(
        'SELECT COUNT(*) as count FROM visitors WHERE visit_date = ?',
        [today],
        (err, row) => {
            if (err) {
                console.error('Ошибка при подсчете посетителей:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ count: row.count, date: today });
        }
    );
});

// API: зарегистрировать нового посетителя (с защитой от повторов)
app.post('/api/visitors/register', (req, res) => {
    // Получаем IP посетителя
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const today = new Date().toISOString().split('T')[0];
    
    // Пытаемся вставить запись. Если IP уже есть за сегодня — INSERT игнорируется
    db.run(
        'INSERT OR IGNORE INTO visitors (ip, visit_date) VALUES (?, ?)',
        [ip, today],
        function(err) {
            if (err) {
                console.error('Ошибка при регистрации посетителя:', err);
                return res.status(500).json({ error: err.message });
            }
            
            // this.changes === 1 — новая запись, this.changes === 0 — повторный визит
            res.json({ 
                success: true, 
                isNew: this.changes === 1,
                message: this.changes === 1 ? 'Новый посетитель' : 'Возвращающийся посетитель'
            });
        }
    );
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   🚀 PC REVIEW BACKEND (VK) ЗАПУЩЕН      ║
╠════════════════════════════════════════════╣
║   Порт: ${PORT}                              ║
║   Группа ВК: ${VK_GROUP_ID}                    ║
║   Время: ${new Date().toLocaleString('ru-RU')}   ║
╚════════════════════════════════════════════╝
    `);
});

