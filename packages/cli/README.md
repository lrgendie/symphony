# @symphony/cli

`symphony` — yerel (Ollama) ve bulut (Claude/GPT/Gemini) LLM'leri ve kod agent'larını tek
terminal komutundan yöneten arayüz. Argümansız `symphony` bir karşılama ekranı + sohbet/agent
seçici açar; `symphony agent <ad> "<görev>"` bir kod agent'ı çalıştırır (izin isteklerini
terminalde onaylarsın); `symphony status`/`symphony models`/`symphony history` gibi alt
komutlar durum sorgular.

## Kurulum

```
npm install -g @symphony/cli
symphony
```

İlk çalıştırmada `~/.symphony/` dizini oluşturulur (yapılandırma, agent tanımları, yerel
veri). API anahtarları OS keychain'inde saklanır — hiçbir zaman diske düz metin yazılmaz.

Kaynak kod ve tam dokümantasyon: https://github.com/lrgendie/symphony
