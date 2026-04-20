const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== КОНФИГУРАЦИЯ ВКОНТАКТЕ =====
const VK_ACCESS_TOKEN = 'vk1.a.ODur1t74H2a9vc0kzaCHwzrZNWXkA9wP4t5w7yK557N4ajg0yELIl0N9yrWsPkMPT6auylxXST8tRXs-b8kgEhlCfggufgnk2aqIzLUI-_m_kFIK31LSFVL0B6m30icP1tlLVbQuhryjX3y2b5Kb7ri0bSXe2P0KqwEhx8XFW738KQ3L5Q9zVGzBk9jkZWjt54m7pKVxOQXy1Wcuvn-BIg';
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

// ===== ФУНКЦИЯ ОТПРАВКИ В ВКОНТАКТЕ =====
async function sendToVK(text) {
    // peer_id с минусом = сообщество (беседа)
    const peerId = -VK_GROUP_ID;
    
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
