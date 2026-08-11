const API_BASE = '/api/customers';

// ==================== AUTH ====================
function getToken() { return localStorage.getItem('crm_token'); }
function setToken(t) { localStorage.setItem('crm_token', t); }
function clearToken() { localStorage.removeItem('crm_token'); }

function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() };
}

async function apiFetch(url, options = {}) {
    options.headers = { ...authHeaders(), ...(options.headers || {}) };
    const res = await fetch(url, options);
    if (res.status === 401) { logout(); return null; }
    return res;
}

function logout() {
    clearToken();
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

// Login Form Handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    btn.textContent = 'Giriş yapılıyor...';
    btn.disabled = true;
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (res.ok) {
            const data = await res.json();
            setToken(data.access_token);
            document.getElementById('loginOverlay').style.display = 'none';
            fetchCustomers();
        } else {
            document.getElementById('loginError').style.display = 'block';
        }
    } catch {
        document.getElementById('loginError').style.display = 'block';
    }
    btn.textContent = 'Giriş Yap';
    btn.disabled = false;
});

document.getElementById('logoutBtn').addEventListener('click', logout);

// ==================== APP ====================

// Elements
const customersTableBody = document.getElementById('customersTableBody');
const loading = document.getElementById('loading');
const modal = document.getElementById('customerModal');
const addCustomerBtn = document.getElementById('addCustomerBtn');
const closeModal = document.querySelector('.close-modal');
const customerForm = document.getElementById('customerForm');
const modalTitle = document.getElementById('modalTitle');
const toastContainer = document.getElementById('toastContainer');
const searchInput = document.getElementById('searchInput');
const viewModal = document.getElementById('viewCustomerModal');
const closeViewBtns = document.querySelectorAll('.view-close, #closeViewBtn');
const viewCustomerDetails = document.getElementById('viewCustomerDetails');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const tabBtns = document.querySelectorAll('.tab-btn');
const listView = document.getElementById('listView');
const calendarView = document.getElementById('calendarView');
let calendar = null;

// State
let allCustomers = [];
let currentSourceFilter = null;
let currentStatusFilter = null;
let currentEventFilter = null;

// Initial Load — token yoksa login göster, varsa direkt yükle
document.addEventListener('DOMContentLoaded', () => {
    if (!getToken()) {
        document.getElementById('loginOverlay').style.display = 'flex';
    } else {
        document.getElementById('loginOverlay').style.display = 'none';
        fetchCustomers();
    }
    setupFilters();
});


// Fetch Customers
async function fetchCustomers() {
    showLoading(true);
    try {
        let url = API_BASE;
        const params = new URLSearchParams();
        if (currentSourceFilter && currentSourceFilter !== 'all') params.append('kaynak', currentSourceFilter);
        if (currentStatusFilter && currentStatusFilter !== 'all') params.append('durum', currentStatusFilter);
        if (currentEventFilter && currentEventFilter !== 'all') params.append('etkinlik_adi', currentEventFilter);

        if (params.toString()) url += '?' + params.toString();

        const response = await apiFetch(url);
        if (!response) return;
        allCustomers = await response.json();

        // If there's an active search, filter immediately
        const searchTerm = searchInput.value.toLowerCase().trim();
        if (searchTerm) {
            const filtered = allCustomers.filter(c => c.ad_soyad.toLowerCase().includes(searchTerm));
            renderTable(filtered);
        } else {
            renderTable(allCustomers);
        }

        calculateStats(allCustomers);
        renderCalendar(allCustomers);
    } catch (error) {
        showToast('Veriler yüklenirken hata oluştu!', true);
    } finally {
        showLoading(false);
    }
}

// Render Table
function renderTable(customers) {
    customersTableBody.innerHTML = '';

    if (customers.length === 0) {
        customersTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center">Kayıt bulunamadı.</td></tr>';
        return;
    }

    customers.forEach(customer => {
        const tr = document.createElement('tr');

        const badgeClass = getBadgeClass(customer.durum);
        const toplam = customer.toplam_fiyat || 0;
        const kalan = toplam - (customer.alinan_avans || 0) - (customer.alinan_odeme || 0);

        let kalanHtml = '';
        if (toplam > 0) {
            if (kalan <= 0) {
                kalanHtml = '<br><small style="color:#10b981; font-weight:bold">Tamamen Ödendi</small>';
            } else {
                kalanHtml = `<br><small style="color:#ef4444">Kalan: ${kalan} TL</small>`;
            }
        } else if (kalan < 0) {
            kalanHtml = `<br><small style="color:#10b981; font-weight:bold">Tamamen Ödendi</small>`;
        }

        tr.setAttribute('onclick', `viewCustomer(${customer.id})`);
        tr.style.cursor = 'pointer';

        tr.innerHTML = `
            <td>#${customer.id}</td>
            <td><strong>${customer.ad_soyad}</strong></td>
            <td>${customer.telefon} ${formatWaLink(customer.telefon)}</td>
            <td>${customer.kaynak}</td>
            <td>${customer.etkinlik_adi || '-'}</td>
            <td>${customer.kisi_sayisi ? customer.kisi_sayisi + ' Kişi' : '-'}</td>
            <td><strong>${toplam} TL</strong>${kalanHtml}</td>
            <td><span class="badge ${badgeClass}">${customer.durum}</span></td>
            <td>${customer.etkinlik_tarihi ? formatDate(customer.etkinlik_tarihi) : '-'}</td>
            <td>${customer.notlar || '-'}</td>
            <td>
                <button class="btn btn-edit" onclick="event.stopPropagation(); editCustomer(${customer.id})">Düzenle</button>
                <button class="btn btn-danger" onclick="event.stopPropagation(); deleteCustomer(${customer.id})">Sil</button>
            </td>
        `;
        customersTableBody.appendChild(tr);
    });
}

// Helper: Get Badge Class
function getBadgeClass(durum) {
    switch (durum) {
        case 'Yeni Ulaştı': return 'badge-yeni';
        case 'Randevu Oluşturuldu': return 'badge-randevu';
        case 'Görüşüldü': return 'badge-gorusuldu';
        case 'Etkinlik Gerçekleşti': return 'badge-etkinlik';
        case 'İptal': return 'badge-iptal';
        default: return '';
    }
}

// Helper: Format Date
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR');
}

// Setup Filters
function setupFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filterType = e.target.getAttribute('data-type');
            const filterValue = e.target.getAttribute('data-filter');

            // Remove active class from same group
            document.querySelectorAll(`.filter-btn[data-type="${filterType}"]`).forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            if (filterType === 'kaynak') currentSourceFilter = filterValue;
            if (filterType === 'durum') currentStatusFilter = filterValue;
            if (filterType === 'etkinlik_adi') currentEventFilter = filterValue;

            fetchCustomers();
        });
    });

    // Setup Tabs
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            const view = e.target.getAttribute('data-view');
            if (view === 'list') {
                listView.style.display = 'block';
                calendarView.style.display = 'none';
            } else {
                listView.style.display = 'none';
                calendarView.style.display = 'block';
                if (calendar) {
                    calendar.render();
                    if (calendar.view) updateMonthlyCalendarStats(calendar.view);
                }
            }
        });
    });

    if (exportExcelBtn) {
        exportExcelBtn.addEventListener('click', () => {
            exportToExcel(allCustomers);
        });
    }
}

// Modal Logic
addCustomerBtn.addEventListener('click', () => {
    customerForm.reset();
    document.getElementById('customerId').value = '';
    modalTitle.textContent = 'Yeni Müşteri Ekle';
    modal.classList.add('show');
});

closeModal.addEventListener('click', () => {
    modal.classList.remove('show');
});

closeViewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        viewModal.classList.remove('show');
    });
});

window.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('show');
    if (e.target === viewModal) viewModal.classList.remove('show');
    const statModal = document.getElementById('statDetailsModal');
    if (statModal && e.target === statModal) statModal.classList.remove('show');
});

const closeStatDetailsBtn = document.getElementById('closeStatDetailsBtn');
const statDetailsClose = document.querySelector('.stat-details-close');
if (closeStatDetailsBtn) {
    closeStatDetailsBtn.addEventListener('click', () => {
        document.getElementById('statDetailsModal').classList.remove('show');
    });
}
if (statDetailsClose) {
    statDetailsClose.addEventListener('click', () => {
        document.getElementById('statDetailsModal').classList.remove('show');
    });
}

const statRevenueCard = document.getElementById('statRevenueCard');
if (statRevenueCard) {
    statRevenueCard.addEventListener('click', openRevenueDetails);
}

const statDepositCard = document.getElementById('statDepositCard');
if (statDepositCard) {
    statDepositCard.addEventListener('click', openDepositDetails);
}

searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
        renderTable(allCustomers);
        return;
    }
    const filtered = allCustomers.filter(c => c.ad_soyad.toLowerCase().includes(term));
    renderTable(filtered);
});

// Form Submit (Create or Update)
customerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('customerId').value;
    const isUpdate = id !== '';

    const payload = {
        ad_soyad: document.getElementById('ad_soyad').value,
        telefon: document.getElementById('telefon').value,
        kaynak: document.getElementById('kaynak').value,
        durum: document.getElementById('durum').value,
        etkinlik_adi: document.getElementById('etkinlik_adi').value || null,
        etkinlik_tarihi: document.getElementById('etkinlik_tarihi').value || null,
        kisi_sayisi: parseInt(document.getElementById('kisi_sayisi').value) || null,
        toplam_fiyat: parseInt(document.getElementById('toplam_fiyat').value) || 0,
        alinan_avans: parseInt(document.getElementById('alinan_avans').value) || 0,
        alinan_odeme: parseInt(document.getElementById('alinan_odeme').value) || 0,
        notlar: document.getElementById('notlar').value || null
    };

    try {
        const url = isUpdate ? `${API_BASE}/${id}` : API_BASE;
        const method = isUpdate ? 'PUT' : 'POST';

        const response = await apiFetch(url, {
            method: method,
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            modal.classList.remove('show');
            fetchCustomers();
            showToast(isUpdate ? 'Müşteri başarıyla güncellendi!' : 'Müşteri başarıyla eklendi!');
        } else {
            showToast('İşlem başarısız oldu.', true);
        }
    } catch (error) {
        showToast('Bir hata oluştu.', true);
    }
});

// Edit Customer
async function editCustomer(id) {
    try {
        const response = await apiFetch(`${API_BASE}/${id}`);
        if (response.ok) {
            const customer = await response.json();

            document.getElementById('customerId').value = customer.id;
            document.getElementById('ad_soyad').value = customer.ad_soyad;
            document.getElementById('telefon').value = customer.telefon;
            document.getElementById('kaynak').value = customer.kaynak;
            document.getElementById('durum').value = customer.durum;
            document.getElementById('etkinlik_adi').value = customer.etkinlik_adi || '';
            document.getElementById('etkinlik_tarihi').value = customer.etkinlik_tarihi || '';
            document.getElementById('kisi_sayisi').value = customer.kisi_sayisi || '';
            document.getElementById('toplam_fiyat').value = customer.toplam_fiyat || 0;
            document.getElementById('alinan_avans').value = customer.alinan_avans || 0;
            document.getElementById('alinan_odeme').value = customer.alinan_odeme || 0;
            document.getElementById('notlar').value = customer.notlar || '';

            modalTitle.textContent = 'Müşteri Düzenle';
            modal.classList.add('show');
        }
    } catch (error) {
        showToast('Müşteri bilgileri alınamadı.', true);
    }
}

// Delete Customer
async function deleteCustomer(id) {
    if (confirm('Bu müşteriyi silmek istediğinize emin misiniz?')) {
        try {
            const response = await apiFetch(`${API_BASE}/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                fetchCustomers();
                showToast('Müşteri silindi.');
            } else {
                showToast('Silme işlemi başarısız.', true);
            }
        } catch (error) {
            showToast('Bir hata oluştu.', true);
        }
    }
}

// View Customer
async function viewCustomer(id) {
    try {
        const response = await apiFetch(`${API_BASE}/${id}`);
        if (response && response.ok) {
            const customer = await response.json();

            viewCustomerDetails.innerHTML = `
                <div class="detail-row">
                    <strong>Ad Soyad</strong>
                    <span>${customer.ad_soyad}</span>
                </div>
                <div class="detail-row">
                    <strong>Telefon</strong>
                    <span>${customer.telefon} ${formatWaLink(customer.telefon)}</span>
                </div>
                <div class="detail-row">
                    <strong>Kaynak</strong>
                    <span>${customer.kaynak}</span>
                </div>
                <div class="detail-row">
                    <strong>Etkinlik Adı</strong>
                    <span>${customer.etkinlik_adi || '-'}</span>
                </div>
                <div class="detail-row">
                    <strong>Kişi Sayısı</strong>
                    <span>${customer.kisi_sayisi ? customer.kisi_sayisi + ' Kişi' : '-'}</span>
                </div>
                <div class="detail-row">
                    <strong>Finansal Durum</strong>
                    <span>Fiyat: ${customer.toplam_fiyat || 0} TL | Kapora: ${customer.alinan_avans || 0} TL | Ödeme: ${customer.alinan_odeme || 0} TL | Kalan: ${(customer.toplam_fiyat || 0) - (customer.alinan_avans || 0) - (customer.alinan_odeme || 0)} TL</span>
                </div>
                <div class="detail-row">
                    <strong>Durum</strong>
                    <span><span class="badge ${getBadgeClass(customer.durum)}">${customer.durum}</span></span>
                </div>
                <div class="detail-row">
                    <strong>Etkinlik Tarihi</strong>
                    <span>${customer.etkinlik_tarihi ? formatDate(customer.etkinlik_tarihi) : '-'}</span>
                </div>
                <div class="detail-row">
                    <strong>Notlar</strong>
                    <span>${customer.notlar || '-'}</span>
                </div>
            `;
            viewModal.classList.add('show');
        }
    } catch (error) {
        showToast('Müşteri bilgileri alınamadı.', true);
    }
}

// Helpers
function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    if (isError) toast.style.backgroundColor = 'var(--danger-color)';

    toastContainer.appendChild(toast);

    // Trigger reflow
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Calculate Stats
function calculateStats(customers) {
    document.getElementById('statTotalEvents').textContent = customers.length;

    let totalRev = 0;
    let totalDeposit = 0;
    let pending = 0;
    const sources = {};

    customers.forEach(c => {
        // Sadece "Etkinlik Gerçekleşti" olanlar ciroya eklenir
        if (c.durum === 'Etkinlik Gerçekleşti') {
            totalRev += (c.toplam_fiyat || 0);
        }

        // Verilen kaporalar
        totalDeposit += (c.alinan_avans || 0);

        // Bekleyen tahsilat (İptal edilmeyenler)
        if (c.durum !== 'İptal') {
            pending += ((c.toplam_fiyat || 0) - (c.alinan_avans || 0) - (c.alinan_odeme || 0));
        }

        if (c.kaynak) {
            sources[c.kaynak] = (sources[c.kaynak] || 0) + 1;
        }
    });

    document.getElementById('statTotalRevenue').textContent = totalRev.toLocaleString('tr-TR') + ' TL';
    
    const depositEl = document.getElementById('statTotalDeposit');
    if (depositEl) {
        depositEl.textContent = totalDeposit.toLocaleString('tr-TR') + ' TL';
    }

    document.getElementById('statPendingBalance').textContent = pending.toLocaleString('tr-TR') + ' TL';

    // Find top source
    let topSource = '-';
    let max = 0;
    for (const [src, count] of Object.entries(sources)) {
        if (count > max) {
            max = count;
            topSource = src;
        }
    }
    document.getElementById('statTopSource').textContent = topSource;
}

// Stat Detail Modals
function openRevenueDetails() {
    const revenueCustomers = allCustomers.filter(c => c.durum === 'Etkinlik Gerçekleşti');
    const modal = document.getElementById('statDetailsModal');
    const title = document.getElementById('statDetailsTitle');
    const content = document.getElementById('statDetailsContent');

    title.textContent = 'Ciro Yapan Müşteriler (Etkinlik Gerçekleşti)';

    if (revenueCustomers.length === 0) {
        content.innerHTML = '<p style="text-align:center; color:#64748b; padding:1.5rem;">"Etkinlik Gerçekleşti" durumunda müşteri bulunamadı.</p>';
    } else {
        let html = `
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border-color); color:#64748b; font-size:0.8rem;">
                        <th style="padding:0.6rem;">Müşteri</th>
                        <th style="padding:0.6rem;">Etkinlik</th>
                        <th style="padding:0.6rem;">Tarih</th>
                        <th style="padding:0.6rem;">Ciro Tutar</th>
                        <th style="padding:0.6rem;">Kalan</th>
                    </tr>
                </thead>
                <tbody>
        `;

        revenueCustomers.forEach(c => {
            const toplam = c.toplam_fiyat || 0;
            const kalan = toplam - (c.alinan_avans || 0) - (c.alinan_odeme || 0);
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; cursor:pointer;" onclick="viewCustomer(${c.id}); document.getElementById('statDetailsModal').classList.remove('show');">
                    <td style="padding:0.6rem;"><strong>${c.ad_soyad}</strong> ${formatWaLink(c.telefon)}</td>
                    <td style="padding:0.6rem;">${c.etkinlik_adi || '-'}</td>
                    <td style="padding:0.6rem;">${c.etkinlik_tarihi ? formatDate(c.etkinlik_tarihi) : '-'}</td>
                    <td style="padding:0.6rem; color:#10b981; font-weight:700;">${toplam.toLocaleString('tr-TR')} TL</td>
                    <td style="padding:0.6rem;">${kalan <= 0 ? '<span style="color:#10b981; font-weight:600;">Tamamı Ödendi</span>' : `<span style="color:#ef4444; font-weight:600;">${kalan.toLocaleString('tr-TR')} TL</span>`}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        content.innerHTML = html;
    }

    modal.classList.add('show');
}

function openDepositDetails() {
    const depositCustomers = allCustomers.filter(c => (c.alinan_avans || 0) > 0);
    const modal = document.getElementById('statDetailsModal');
    const title = document.getElementById('statDetailsTitle');
    const content = document.getElementById('statDetailsContent');

    title.textContent = 'Kapora Veren Müşteriler';

    if (depositCustomers.length === 0) {
        content.innerHTML = '<p style="text-align:center; color:#64748b; padding:1.5rem;">Kapora veren müşteri bulunamadı.</p>';
    } else {
        let html = `
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border-color); color:#64748b; font-size:0.8rem;">
                        <th style="padding:0.6rem;">Müşteri</th>
                        <th style="padding:0.6rem;">Verilen Kapora</th>
                        <th style="padding:0.6rem;">Etkinlik</th>
                        <th style="padding:0.6rem;">Durum</th>
                    </tr>
                </thead>
                <tbody>
        `;

        depositCustomers.forEach(c => {
            const avans = c.alinan_avans || 0;
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; cursor:pointer;" onclick="viewCustomer(${c.id}); document.getElementById('statDetailsModal').classList.remove('show');">
                    <td style="padding:0.6rem;"><strong>${c.ad_soyad}</strong> ${formatWaLink(c.telefon)}</td>
                    <td style="padding:0.6rem; color:#2563eb; font-weight:700;">${avans.toLocaleString('tr-TR')} TL</td>
                    <td style="padding:0.6rem;">${c.etkinlik_adi || '-'}</td>
                    <td style="padding:0.6rem;"><span class="badge ${getBadgeClass(c.durum)}">${c.durum}</span></td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        content.innerHTML = html;
    }

    modal.classList.add('show');
}

// Render Calendar
let currentCalendarCustomers = [];

function renderCalendar(customers) {
    currentCalendarCustomers = customers;
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    const events = customers
        .filter(c => c.etkinlik_tarihi)
        .map(c => ({
            title: c.ad_soyad,
            start: c.etkinlik_tarihi,
            allDay: true,
            color: 'transparent',
            extendedProps: {
                id: c.id,
                etkinlik_adi: c.etkinlik_adi || 'Etkinlik',
                kisi_sayisi: c.kisi_sayisi,
                durum: c.durum
            }
        }));

    if (!calendar) {
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'tr',
            showNonCurrentDates: false,
            fixedWeekCount: false,
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek'
            },
            events: events,
            datesSet: function (info) {
                updateMonthlyCalendarStats(info.view);
            },
            eventContent: function (arg) {
                const p = arg.event.extendedProps;
                let html = `<div class="custom-cal-event" style="border-left: 4px solid ${getBadgeColor(p.durum)}">`;
                html += `<div class="c-title">${arg.event.title}</div>`;
                html += `<div class="c-type">${p.etkinlik_adi}</div>`;
                if (p.kisi_sayisi) {
                    html += `<div class="c-kisi">${p.kisi_sayisi} Kişi</div>`;
                }
                html += `</div>`;
                return { html: html };
            },
            eventClick: function (info) {
                viewCustomer(info.event.extendedProps.id);
            }
        });
        calendar.render();
    } else {
        calendar.removeAllEvents();
        calendar.addEventSource(events);
        if (calendar.view) {
            updateMonthlyCalendarStats(calendar.view);
        }
    }
}

function updateMonthlyCalendarStats(view) {
    if (!view || !view.currentStart) return;
    const activeDate = view.currentStart;
    const year = activeDate.getFullYear();
    const month = activeDate.getMonth(); // 0-indexed

    let monthRev = 0;
    let monthDeposit = 0;
    let monthPending = 0;
    let monthEventCount = 0;

    currentCalendarCustomers.forEach(c => {
        if (!c.etkinlik_tarihi) return;

        const parts = c.etkinlik_tarihi.split('-');
        if (parts.length < 3) return;
        const cYear = parseInt(parts[0], 10);
        const cMonth = parseInt(parts[1], 10) - 1;

        if (cYear === year && cMonth === month) {
            monthEventCount++;

            // Sadece Etkinlik Gerçekleşti olanlar ciro
            if (c.durum === 'Etkinlik Gerçekleşti') {
                monthRev += (c.toplam_fiyat || 0);
            }

            // Yatırılan Kapora
            monthDeposit += (c.alinan_avans || 0);

            // Bekleyen Tahsilat (İptal hariç kalan)
            if (c.durum !== 'İptal') {
                const kalan = (c.toplam_fiyat || 0) - (c.alinan_avans || 0) - (c.alinan_odeme || 0);
                if (kalan > 0) {
                    monthPending += kalan;
                }
            }
        }
    });

    const revEl = document.getElementById('calMonthRevenue');
    const depEl = document.getElementById('calMonthDeposit');
    const pendEl = document.getElementById('calMonthPending');
    const countEl = document.getElementById('calMonthCount');

    if (revEl) revEl.textContent = monthRev.toLocaleString('tr-TR') + ' TL';
    if (depEl) depEl.textContent = monthDeposit.toLocaleString('tr-TR') + ' TL';
    if (pendEl) pendEl.textContent = monthPending.toLocaleString('tr-TR') + ' TL';
    if (countEl) countEl.textContent = monthEventCount;
}

function getBadgeColor(durum) {
    switch (durum) {
        case 'Yeni Ulaştı': return '#3b82f6';
        case 'Randevu Oluşturuldu': return '#8b5cf6';
        case 'Görüşüldü': return '#f59e0b';
        case 'Etkinlik Gerçekleşti': return '#10b981';
        case 'İptal': return '#ef4444';
        default: return '#64748b';
    }
}

// Export to Excel
function exportToExcel(customers) {
    if (customers.length === 0) {
        showToast('Dışa aktarılacak veri yok.', true);
        return;
    }

    const data = customers.map(c => ({
        'ID': c.id,
        'Ad Soyad': c.ad_soyad,
        'Telefon': c.telefon,
        'Kaynak': c.kaynak,
        'Etkinlik Adı': c.etkinlik_adi || '',
        'Kişi Sayısı': c.kisi_sayisi || '',
        'Durum': c.durum,
        'Etkinlik Tarihi': c.etkinlik_tarihi ? formatDate(c.etkinlik_tarihi) : '',
        'Toplam Fiyat (TL)': c.toplam_fiyat || 0,
        'Kapora (TL)': c.alinan_avans || 0,
        'Alınan Ödeme (TL)': c.alinan_odeme || 0,
        'Kalan Bakiye (TL)': (c.toplam_fiyat || 0) - (c.alinan_avans || 0) - (c.alinan_odeme || 0),
        'Notlar': c.notlar || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Müşteriler");

    XLSX.writeFile(wb, "Nazay_Bahce_Musteriler.xlsx");
}

// Format WhatsApp Link
function formatWaLink(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) cleaned = '90' + cleaned;
    if (cleaned.length === 11 && cleaned.startsWith('0')) cleaned = '90' + cleaned.substring(1);

    if (cleaned.length >= 12) {
        return `<a href="https://wa.me/${cleaned}" target="_blank" class="wa-btn" onclick="event.stopPropagation()">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
            WA
        </a>`;
    }
    return '';
}
