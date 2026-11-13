#!/usr/bin/env bash
# Синтез пака звуков «GX» (sounds/*.ogg, кроме glitch и lumitime) на ffmpeg. Запуск: bash dev/make-gx-sounds.sh
# Каждый звук — формула aevalsrc (t — время, мс-огибающие exp(-t*k)), затем фейд-ин/аут, нормализация пика до -1.5 дБ и ogg Vorbis.
set -euo pipefail
OUT="$(cd "$(dirname "$0")/.." && pwd)/sounds"
TMP="$(mktemp -d)"
mkdir -p "$OUT"
PI=3.14159265
TAU="6.2831853"
N='(random(0)*2-1)'   # белый шум

# make <имя> <длительность> <выражение>
make() {
  local name=$1 dur=$2 expr=${3//,/\,}
  ffmpeg -v error -y -f lavfi -i "aevalsrc=exprs=${expr}:s=44100:d=${dur}" -ac 1 "$TMP/$name.wav"
  local peak gain
  peak=$(ffmpeg -i "$TMP/$name.wav" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB.*/\1/p')
  gain=$(awk -v p="$peak" 'BEGIN{printf "%.2f", -1.5 - p}')
  ffmpeg -v error -y -i "$TMP/$name.wav" \
    -af "volume=${gain}dB,afade=t=in:d=0.002,afade=t=out:st=$(awk -v d="$dur" 'BEGIN{printf "%.4f", d-0.012}'):d=0.012" \
    -c:a libvorbis -q:a 4 "$OUT/$name.ogg"
  echo "$name: ${dur}s peak ${peak} dB -> gain ${gain} dB"
}

# открытие вкладки: мягкий «вжух» вверх — свип 380→1100 Гц с шумовым хвостиком, плавная огибающая
make tab-open 0.24 "pow(sin($PI*t/0.24)\,2)*(0.55*sin($TAU*(380*t+1500*t*t)) + 0.2*sin($TAU*2*(380*t+1500*t*t)) + 0.1*$N*sin($PI*t/0.24))"
# закрытие вкладки: свип вниз 1000→300 Гц
make tab-close 0.20 "pow(sin($PI*t/0.20)\,2)*(0.55*sin($TAU*(1000*t-1750*t*t)) + 0.2*sin($TAU*2*(1000*t-1750*t*t)) + 0.08*$N*sin($PI*t/0.20))"
# переключение вкладки: короткий двухтоновый «блип» 880 → 1320 Гц
make tab-switch 0.10 "(1-exp(-t*3000))*( if(lt(t\,0.04)\,0.6*sin($TAU*880*t)*exp(-t*40)\,0) + if(gte(t\,0.04)\,0.6*sin($TAU*1320*(t-0.04))*exp(-(t-0.04)*45)\,0) )"
# клик: глухой щелчок — низкий «тук» 120→90 Гц и шум
make click 0.07 "(1-exp(-t*4000))*(0.7*sin($TAU*(120*t-300*t*t))*exp(-t*70) + 0.3*$N*exp(-t*500))"
# конец загрузки: восходящий арпеджио C5-E5-G5 с блеском октавой выше (три ноты, общий хвост)
make download 0.40 "(1-exp(-t*2500))*( 0.45*sin($TAU*523.25*t)*exp(-t*9) + if(gte(t\,0.09)\,(0.45*sin($TAU*659.25*(t-0.09))+0.12*sin($TAU*1318.5*(t-0.09)))*exp(-(t-0.09)*9)\,0) + if(gte(t\,0.18)\,(0.5*sin($TAU*783.99*(t-0.18))+0.14*sin($TAU*1568*(t-0.18)))*exp(-(t-0.18)*8)\,0) )"

rm -rf "$TMP"
