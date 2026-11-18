const API = localStorage.getItem('api') || 'http://localhost:3000';
const TOKEN = localStorage.getItem('token') || '';
const invoice = new URLSearchParams(location.search).get('invoice');
const unwrap = (r) => r.data ?? r;   // TransformInterceptor có thể bọc response

async function fetchStatus() {
  const url = `${API}/payments/sepay/${encodeURIComponent(invoice)}/status`;
  console.log('Fetching status:', url);
  const res = await fetch(url);
  console.log('Response status:', res.status);
  if (!res.ok) {
    const err = await res.text();
    console.error('Error response:', err);
    throw new Error('status ' + res.status + ': ' + err);
  }
  return unwrap(await res.json());
}

// Tạo invoice mới cho cùng đơn hàng rồi chuyển sang SePay
async function retryPayment(orderId) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(`${API}/payments/sepay/checkout`, {
    method: 'POST', headers, body: JSON.stringify({ orderId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(JSON.stringify(data)); return; }

  const { checkoutUrl, fields } = unwrap(data);
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = checkoutUrl;
  for (const [k, v] of Object.entries(fields)) {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = k; i.value = String(v);
    form.appendChild(i);
  }
  document.body.appendChild(form);
  form.submit();
}