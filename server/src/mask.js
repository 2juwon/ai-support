/* 개인정보처럼 보이는 글자를 가림. 페이지(index.html)에도 같은 함수가 들어 있음 — 둘을 같이 고칠 것 */
export function mask(s) {
  return String(s ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[이메일]')
    .replace(/\d{6}\s*-\s*[1-8]\d{6}/g, '[주민번호]')
    .replace(/(\+?82[\s-]?)?0\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{4}/g, '[전화번호]')
    .replace(/\d[\d\s-]{8,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[번호]' : m))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
