# @lrgendie/core

Symphony'nin çekirdek daemon'ı (`symphonyd`): yerel (Ollama) ve bulut (Claude/GPT/Gemini)
LLM'leri ve kod agent'larını tek WS/REST sunucusundan yönetir. Provider adaptörleri, SQLite
veri katmanı, agent motoru (izin sistemi + araç seti) ve model yönlendirici burada yaşar.

Bu paket doğrudan kurulmaz; `@lrgendie/cli`'nin bağımlılığıdır ve `symphony` komutu
tarafından arka planda otomatik başlatılır. Kaynak kod ve tam dokümantasyon:
https://github.com/lrgendie/symphony
