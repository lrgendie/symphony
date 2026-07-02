// @symphony/shared ortam-bağımsızdır: ne @types/node ne DOM lib'i kullanır.
// crypto.randomUUID hem Node 19+ hem tüm modern tarayıcılarda global mevcuttur;
// yalnızca kullandığımız yüzeyi bildiririz.
declare const crypto: {
  randomUUID(): string;
};
