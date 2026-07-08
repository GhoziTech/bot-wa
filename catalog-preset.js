const db = require('./database');

const PRESET_KEY = 'catalog_preset_2026_07_inventory_v2';

// Harga di bawah adalah harga jual final yang tampil kepada customer.
// Semua produk memakai mode MANUAL secara default supaya stock dapat diatur dengan angka.
// Admin dapat mengubahnya menjadi UNIK atau AUTO melalui Admin Panel.
const products = [
  {
    sortOrder: 1,
    name: 'NETFLIX 1P1U',
    price: 49000,
    stock: 0,
    rating: 4.2,
    sold: 52,
    category: 'Streaming',
    description: '— DURASI 1 BULAN\n— SHARING 1 PROFIL 1 USER\n— FULL GARANSI JIKA ISI FORM PEMBELIAN'
  },
  {
    sortOrder: 2,
    name: 'CANVA PRO MEMBER',
    price: 15000,
    stock: 69,
    rating: 5.0,
    sold: 26,
    category: 'Design & Productivity',
    description: '— DURASI 1 BULAN\n— PRO VIA INVITE EMAIL\n— FULL GARANSI\n— MANUAL PROSES\n— JIKA RUSH ORDER PASTIKAN SELLER ONLINE'
  },
  {
    sortOrder: 3,
    name: 'CAPCUT PRO SHARING',
    price: 25000,
    stock: 0,
    rating: 5.0,
    sold: 13,
    category: 'Editing & Creative',
    description: '— DURASI 25 - 30 DAYS\n— FULL GARANSI BACKFREE\n— SHARING ACCOUNT\n— SHARING ACC DILARANG LOGIN DI PC/LAPTOP'
  },
  {
    sortOrder: 5,
    name: 'SPOTIFY PREM 3 BULAN',
    price: 35000,
    stock: 0,
    rating: 5.0,
    sold: 9,
    category: 'Music',
    description: '— GARANSI 15 HARI\n— PRIVATE ACCOUNT\n— INDIVIDUAL PLAN\n— AKUN DISEDIAKAN SELLER\n— CARI YANG FULL GARANSI? HUBUNGI ADMIN'
  },
  {
    sortOrder: 6,
    name: 'NETFLIX 1P2U',
    price: 35000,
    stock: 0,
    rating: 0.0,
    sold: 8,
    category: 'Streaming',
    description: '— DURASI 1 BULAN\n— SHARING 1 PROFIL 2 USER\n— FULL GARANSI JIKA ISI FORM PEMBELIAN'
  },
  {
    sortOrder: 7,
    name: 'CAPCUT PRO 7 DAYS',
    price: 20000,
    stock: 0,
    rating: 5.0,
    sold: 3,
    category: 'Editing & Creative',
    description: '— PRIVATE ACCOUNT\n— DURASI 6 - 7 HARI\n— FULL GARANSI BACKFREE'
  },
  {
    sortOrder: 8,
    name: 'CHATGPT PRIVATE INVITE',
    price: 35000,
    stock: 0,
    rating: 0.0,
    sold: 2,
    category: 'AI & Productivity',
    description: '— PLAN BISNIS\n— DURASI 1 BULAN\n— VIA INVITE GMAIL\n— FULL GARANSI'
  },
  {
    sortOrder: 9,
    name: 'VIU PREMIUM 6 BULAN',
    price: 18000,
    stock: 7,
    rating: 5.0,
    sold: 2,
    category: 'Streaming',
    description: '— GARANSI 1 BULAN'
  },
  {
    sortOrder: 11,
    name: 'PRODUK TESTER',
    price: 10200,
    stock: 1,
    rating: 0.0,
    sold: 1,
    category: 'Other',
    description: '— PRODUK PENGUJIAN INTERNAL'
  },
  {
    sortOrder: 12,
    name: 'VIDIO TV',
    price: 20000,
    stock: 23,
    rating: 0.0,
    sold: 1,
    category: 'Streaming',
    description: '— DURASI 1 TAHUN\n— GARANSI 6 BULAN\n— PLAN PLATINUM\n— HANYA BISA DIGUNAKAN DI TV'
  },
  {
    sortOrder: 13,
    name: 'DISNEY+ SHARING',
    price: 35000,
    stock: 6,
    rating: 5.0,
    sold: 1,
    category: 'Streaming',
    description: '— DURASI 1 BULAN\n— FULL GARANSI\n— PROSES MANUAL\n— PASTIKAN SELLER ON ATAU BISA MISSCALL TERLEBIH DAHULU'
  },
  {
    sortOrder: 14,
    name: 'CANVA HEAD/OWNER',
    price: 20000,
    stock: 23,
    rating: 5.0,
    sold: 1,
    category: 'Design & Productivity',
    description: '— DURASI 1 BULAN\n— BISA INVITE 100 MEMBER\n— MANUAL PROSES\n— FULL GARANSI\n— ACCOUNT DARI SELLER\n— JIKA RUSH ORDER PASTIKAN SELLER ONLINE'
  },
  {
    sortOrder: 15,
    name: 'SPOTIFY PREM 2 BULAN',
    price: 30000,
    stock: 0,
    rating: 5.0,
    sold: 1,
    category: 'Music',
    description: '— FULL GARANSI\n— PRIVATE ACCOUNT\n— INDIVIDUAL PLAN\n— AKUN DISEDIAKAN SELLER'
  },
  {
    sortOrder: 16,
    name: 'CHATGPT PLUS PRIVATE',
    price: 35000,
    stock: 0,
    rating: 5.0,
    sold: 1,
    category: 'AI & Productivity',
    description: '— DURASI 1 BULAN\n— PRIVATE ACCOUNT\n— FULL GARANSI'
  },
  {
    sortOrder: 17,
    name: 'CAPCUT PRO PRIVATE',
    price: 25000,
    stock: 0,
    rating: 0.0,
    sold: 1,
    category: 'Editing & Creative',
    description: '— DURASI 30 - 35 DAYS\n— FULL GARANSI\n— PRIVATE ACCOUNT\n— SUPPORT ALL DEVICE'
  },
  {
    sortOrder: 18,
    name: 'SPOTIFY PREM 1 BULAN',
    price: 25000,
    stock: 0,
    rating: 0.0,
    sold: 0,
    category: 'Music',
    description: '— FULL GARANSI\n— PRIVATE ACCOUNT\n— INDIVIDUAL PLAN\n— AKUN DISEDIAKAN SELLER'
  },
  {
    sortOrder: 19,
    name: 'TURNITIN PRIVATE',
    price: 60000,
    stock: 0,
    rating: 0.0,
    sold: 0,
    category: 'Education',
    description: '— DURASI 1 BULAN\n— PRIVATE ACCOUNT\n— ACCOUNT DISEDIAKAN SELLER\n— NO REPOSITORY\n— UP TO 21 ASSIGNMENT'
  },
  {
    sortOrder: 20,
    name: 'VIU PREMIUM 1 TAHUN',
    price: 20000,
    stock: 16,
    rating: 0.0,
    sold: 0,
    category: 'Streaming',
    description: '— GARANSI 1 BULAN'
  },
  {
    sortOrder: 21,
    name: 'ALIGHT MOTION',
    price: 30000,
    stock: 7,
    rating: 0.0,
    sold: 0,
    category: 'Editing & Creative',
    description: 'Ⓘ AKSES KE FITUR PREMIUM\nⒾ DURASI 1 TAHUN\nⒾ GARANSI 6 BULAN\nⒾ LOGIN VIA LINK EMAIL'
  }
];

const blockedNames = ['NETFLIX CRACK', 'NETFLIX 1P1U (CRACK)'];

function applyCatalogPreset() {
  const applied = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key=?').get(PRESET_KEY);
  if (applied) {
    return { ok: false, alreadyApplied: true, message: 'Preset katalog versi terbaru sudah pernah diterapkan.' };
  }

  const findByName = db.prepare('SELECT id FROM products WHERE UPPER(TRIM(name))=UPPER(TRIM(?))');
  const update = db.prepare(`
    UPDATE products
    SET sort_order=?, price=?, stock_qty=?, stock_mode='manual', rating=?, sold=?, category=?, description=?, is_active=1
    WHERE id=?
  `);
  const insert = db.prepare(`
    INSERT INTO products
      (sort_order, name, description, category, price, rating, sold, is_active, stock_mode, stock_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'manual', ?)
  `);

  const transaction = db.transaction(() => {
    let updated = 0;
    let inserted = 0;

    for (const item of products) {
      const existing = findByName.get(item.name);
      if (existing) {
        update.run(
          item.sortOrder,
          item.price,
          item.stock,
          item.rating,
          item.sold,
          item.category,
          item.description,
          existing.id
        );
        updated += 1;
      } else {
        insert.run(
          item.sortOrder,
          item.name,
          item.description,
          item.category,
          item.price,
          item.rating,
          item.sold,
          item.stock
        );
        inserted += 1;
      }
    }

    for (const name of blockedNames) {
      db.prepare(`
        UPDATE products
        SET is_active=0, stock_qty=0, sort_order=999
        WHERE UPPER(TRIM(name))=UPPER(TRIM(?))
      `).run(name);
    }

    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(PRESET_KEY, new Date().toISOString());

    return { updated, inserted };
  });

  const result = transaction();
  return {
    ok: true,
    updated: result.updated,
    inserted: result.inserted,
    message: `Preset selesai: ${result.updated} produk diperbarui dan ${result.inserted} produk ditambahkan.`
  };
}

module.exports = { applyCatalogPreset };
