const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== КОНФИГУРАЦИЯ ВКОНТАКТЕ =====
const VK_ACCESS_TOKEN = 'vk1.a.yefEUBQ3PV212zraqBeBJL6fqFk2nH1M29GadDYWKPtuzQ8uxVruJyUv0qOryWzozDfEnzXLqLXt2IC91HXQ1zVpUXswBGLKXC5ameEtNyhhxV3iBdPQZkXAhNmjXrbmR5jF2im03rPDxOSzzMiICm90zjijl_T9ep04cT_Z75RqU5s6qnb1lsd19cypKIA5LKcWRqIanzXkpFHqHqbcZg';
const VK_GROUP_ID = 237856528;  // из вашего скриншота
const VK_API_VERSION = '5.199'
const ADMIN_VK_ID = 1362757094;  // твой личный ID ВК

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./orders.db');

// Таблица заявок
db.run(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, phone TEXT, email TEXT, 
    build TEXT, message TEXT, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Новая таблица для уникальных посетителей (с fingerprint)
db.run(`
  CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    visit_date TEXT NOT NULL,
    UNIQUE(fingerprint, visit_date)
  )
`);

async function sendToVK(text) {
    const url = `https://api.vk.com/method/messages.send`;
    const params = new URLSearchParams({
        access_token: VK_ACCESS_TOKEN,
        v: VK_API_VERSION,
        user_id: ADMIN_VK_ID,
        message: text,
        random_id: Math.floor(Math.random() * 1000000)
    });
    
    const response = await fetch(`${url}?${params}`);
    const result = await response.json();
    return !result.error;
}

// ===== API ЗАЯВОК =====
app.post('/api/submit-order', async (req, res) => {
    const { name, phone, email, build, message } = req.body;
    
    if (!name || !phone) {
        return res.status(400).json({ error: 'Имя и телефон обязательны' });
    }
    
    db.run(`INSERT INTO orders (name, phone, email, build, message) VALUES (?, ?, ?, ?, ?)`,
        [name, phone, email || '', build || '', message || '']
    );
    
    const vkMessage = `📦 НОВАЯ ЗАЯВКА\n\n👤 Имя: ${name}\n📞 Телефон: ${phone}\n📧 Email: ${email || '—'}\n💻 Сборка: ${build || '—'}\n📝 Сообщение: ${message || '—'}\n\n🕐 ${new Date().toLocaleString('ru-RU')}`;
    
    const sent = await sendToVK(vkMessage);
    
    if (sent) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка отправки' });
    }
});

// ===== НОВЫЙ API СЧЕТЧИКА ПОСЕТИТЕЛЕЙ (с fingerprint) =====
app.post('/api/visitors/register', (req, res) => {
    const { fingerprint } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    if (!fingerprint) {
        return res.status(400).json({ error: 'Fingerprint required' });
    }
    
    // Проверяем, был ли этот fingerprint уже сегодня
    db.get(
        'SELECT * FROM visitors WHERE fingerprint = ? AND visit_date = ?',
        [fingerprint, today],
        (err, row) => {
            if (err) {
                console.error('Ошибка при проверке посетителя:', err);
                return res.status(500).json({ error: err.message });
            }
            
            if (row) {
                // Обновляем время последнего визита
                db.run(
                    'UPDATE visitors SET last_seen = CURRENT_TIMESTAMP WHERE id = ?',
                    [row.id]
                );
                return res.json({ 
                    success: true, 
                    isNew: false,
                    message: 'Возвращающийся посетитель'
                });
            }
            
            // Новый уникальный посетитель
            db.run(
                'INSERT INTO visitors (fingerprint, visit_date) VALUES (?, ?)',
                [fingerprint, today],
                function(err) {
                    if (err) {
                        console.error('Ошибка при регистрации:', err);
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ 
                        success: true, 
                        isNew: true,
                        message: 'Новый уникальный посетитель'
                    });
                }
            );
        }
    );
});

// Получить количество уникальных посетителей за сегодня
app.get('/api/visitors/today', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    db.get(
        'SELECT COUNT(*) as count FROM visitors WHERE visit_date = ?',
        [today],
        (err, row) => {
            if (err) {
                console.error('Ошибка при подсчете:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ 
                count: row.count, 
                date: today,
                updatedAt: new Date().toISOString()
            });
        }
    );
});

// Получить статистику за все время
app.get('/api/visitors/stats', (req, res) => {
    db.get('SELECT COUNT(DISTINCT fingerprint) as total FROM visitors', (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ totalUnique: row.total });
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', mode: 'visitor-counter-v2' });
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
