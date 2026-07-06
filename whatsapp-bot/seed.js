const db = require('./database');
db.exec('DELETE FROM products');
db.exec("DELETE FROM sqlite_sequence WHERE name='products'");

const products = [
  {name:'NETFLIX 1P1U',description:'— DURASI 1 BULAN\n— SHARING 1 PROFIL 1 USER\n— FULL GARANSI JIKA ISI FORM PEMBELIAN',category:'Streaming',price:49000,rating:4.2,sold:51},
  {name:'CANVA PRO MEMBER',description:'— DURASI 1 BULAN\n— PRO VIA INVITE EMAIL\n— FULL GARANSI\n— MANUAL PROSES\n— JIKA RUSH ORDER PASTIKAN SELLER ONLINE',category:'Design',price:15000,rating:5.0,sold:26},
  {name:'CAPCUT PRO SHARING',description:'— DURASI 25 - 30 DAYS\n— FULL GARANSI BACKFREE\n— SHARING ACCOUNT\n— SHARING ACC DILARANG LOGIN DI PC/LAPTOP',category:'Editing',price:25000,rating:5.0,sold:12},
  {name:'NETFLIX CRACK',description:'Ⓘ PENJELASAN LENGKAP BACA DI CHANNEL @BACASNKDISINI\nⒾ PLAN PREMIUM\nⒾ GARANSI 24 JAM\nⒾ WAJIB SS SETELAH BERHASIL LOGIN DAN KIRIM KE SELLER\nⒾ DURASI RANDOM BISA HARIAN/BULANAN/TAHUNAN\nⒾ SUPPORT LOGIN TV/HP/PC',category:'Streaming',price:15000,rating:4.8,sold:12},
  {name:'SPOTIFY PREM 3 BULAN',description:'— GARANSI 15 HARI\n— PRIVATE ACCOUNT\n— INDIVIDUAL PLAN\n— AKUN DISEDIAKAN SELLER\n— CARI YANG FULL GARANSI? HUBUNGI ADMIN',category:'Music',price:35000,rating:5.0,sold:9},
  {name:'NETFLIX 1P2U',description:'— DURASI 1 BULAN\n— SHARING 1 PROFIL 2 USER\n— FULL GARANSI JIKA ISI FORM PEMBELIAN',category:'Streaming',price:35000,rating:0.0,sold:8},
  {name:'CAPCUT PRO 7 DAYS',description:'— PRIVATE ACCOUNT\n— DURASI 6 - 7 HARI\n— FULL GARANSI BACKFREE',category:'Editing',price:20000,rating:5.0,sold:3},
  {name:'CHATGPT PRIVATE INVITE',description:'— PLAN BISNIS\n— DURASI 1 BULAN\n— VIA INVITE GMAIL\n— FULL GARANSI',category:'AI',price:35000,rating:0.0,sold:2},
  {name:'VIU PREMIUM 6 BULAN',description:'GARANSI 1 BULAN',category:'Streaming',price:18000,rating:5.0,sold:2},
  {name:'NETFLIX 1P1U (CRACK)',description:'— FULL GARANSI JIKA MEMATUHI RULES!\n— LUMAYAN RAWAN LIMIT SCREEN TAPI SO FAR AMAN\n— KALO MAU YANG ANTILIMIT BELI YG 1P1U BUKAN CRACK',category:'Streaming',price:30000,rating:5.0,sold:2},
  {name:'PRODUK TESTER',description:'GAUSAH DIBELI',category:'Other',price:10200,rating:0.0,sold:1},
  {name:'VIDIO TV',description:'— DURASI 1 TAHUN\n— GARANSI 6 BULAN\n— PLAN PLATINUM\n— HANYA BISA DIGUNAKAN DI TV',category:'Streaming',price:20000,rating:0.0,sold:1},
  {name:'DISNEY+ SHARING',description:'— DURASI 1 BULAN\n— FULL GARANSI\n— PROSES MANUAL\n— PASTIKAN SELLER ON ATAU BISA MISSCALL TERLEBIH DAHULU',category:'Streaming',price:35000,rating:5.0,sold:1},
  {name:'CANVA HEAD/OWNER',description:'— DURASI 1 BULAN\n— BISA INVITE 100 MEMBER\n— MANUAL PROSES\n— FULL GARANSI\n— ACCOUNT DARI SELLER\n— JIKA RUSH ORDER PASTIKAN SELLER ONLINE',category:'Design',price:20000,rating:5.0,sold:1},
  {name:'SPOTIFY PREM 2 BULAN',description:'— FULL GARANSI\n— PRIVATE ACCOUNT\n— INDIVIDUAL PLAN\n— AKUN DISEDIAKAN SELLER',category:'Music',price:30000,rating:5.0,sold:1},
  {name:'CHATGPT PLUS PRIVATE',description:'— DURASI 1 BULAN\n— PRIVATE ACCOUNT\n— FULL GARANSI',category:'AI',price:35000,rating:5.0,sold:1},
  {name:'CAPCUT PRO PRIVATE',description:'— DURASI 30 - 35 DAYS\n— FULL GARANSI\n— PRIVATE ACCOUNT\n— SUPPORT ALL DEVICE',category:'Editing',price:25000,rating:0.0,sold:1},
  {name:'SPOTIFY PREM 1 BULAN',description:'— FULL GARANSI\n— PRIVATE ACCOUNT\n— INDIVIDUAL PLAN\n— AKUN DISEDIAKAN SELLER',category:'Music',price:25000,rating:0.0,sold:0},
  {name:'TURNITIN PRIVATE',description:'— DURASI 1 BULAN\n— PRIVATE ACCOUNT\n— ACCOUNT DISEDIAKAN SELLER\n— NO REPOSITORY\n— UP TO 21 ASSIGMENT',category:'Education',price:60000,rating:0.0,sold:0},
  {name:'VIU PREMIUM 1 TAHUN',description:'GARANSI 1 BULAN',category:'Streaming',price:20000,rating:0.0,sold:0},
  {name:'ALIGHT MOTION',description:'Ⓘ AKSES KE FITUR PREMIUM\nⒾ DURASI 1 TAHUN\nⒾ GARANSI 6 BULAN\nⒾ LOGIN VIA LINK EMAIL',category:'Editing',price:20000,rating:0.0,sold:0}
];

const insert = db.prepare(`INSERT INTO products (name, description, category, price, rating, sold) VALUES (@name, @description, @category, @price, @rating, @sold)`);
const insertAll = db.transaction(() => { for (const p of products) insert.run(p); });
insertAll();
console.log('✅ 21 produk berhasil ditambahkan dengan harga baru (+10.000).');
process.exit(0);