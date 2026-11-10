// Стекло окна как у Windhawk «Translucent Windows»: Zen (nsWindow::UpdateOpaqueRegionInternal) после отрисовок сужает стекло Windows
// (DwmExtendFrameIntoClientArea) до «непрозрачной области» — на кадр при переключении вкладок и пока грузится сайт там чёрное.
// Windhawk перехватывал этот вызов и всегда ставил стекло на всё окно. Делаем то же: в таблице отложенного импорта xul.dll адрес функции
// подменяется на заглушку в машинном коде (x64): «rdx = &{-1,-1,-1,-1}; jmp DwmExtendFrameIntoClientArea». Без JS в момент вызова:
// колбэк js-ctypes посреди отрисовки ронял процесс (проверено 2026-11-10).
// Подмена общая для процесса: включена, пока хоть одно окно в прозрачном режиме (setGlass), иначе адрес возвращается.
const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
const I = ctypes.int32_t, U32 = ctypes.uint32_t, P = ctypes.voidptr_t, UP = ctypes.uintptr_t, W = ctypes.winapi_abi;
const glass = new Set(); // HWND окон в прозрачном режиме
let hook = null; // { orig, stub, write } после подготовки; false — не вышло (не x64, нет таблицы и т. п.)

const num = p => Number(ctypes.cast(p, UP).value.toString());
const at = (n, t) => ctypes.cast(UP(n), t.ptr).contents;
const cstr = n => { let s = ""; for (let c; (c = at(n++, ctypes.uint8_t)); ) s += String.fromCharCode(c); return s; };
const le64 = n => { const b = []; let v = BigInt(n); for (let i = 0; i < 8; i++) { b.push(Number(v & 0xffn)); v >>= 8n; } return b; };

// адрес ячейки функции dll!name в таблице отложенного импорта модуля base (PE32+)
function delaySlot(base, dll, name) {
  const opt = base + at(base + 0x3c, U32) + 24;
  if (at(opt, ctypes.uint16_t) != 0x20b) return 0;
  const dir = at(opt + 112 + 13 * 8, U32); // IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT
  for (let d = base + dir; dir && at(d + 4, U32); d += 32) {
    if (cstr(base + at(d + 4, U32)).toLowerCase() != dll) continue;
    const names = base + at(d + 16, U32), iat = base + at(d + 12, U32);
    for (let i = 0; ; i++) {
      const lo = at(names + i * 8, U32), hi = at(names + i * 8 + 4, U32);
      if (!lo && !hi) break;
      if (!(hi & 0x80000000) && cstr(base + lo + 2) == name) return iat + i * 8;
    }
  }
  return 0;
}

function prepare() {
  if (hook !== null) return hook;
  hook = false;
  try {
    if (Services.sysinfo.getProperty("arch") != "x86-64") return hook;
    const k32 = ctypes.open("kernel32.dll");
    const getModule = k32.declare("GetModuleHandleW", W, P, ctypes.char16_t.ptr);
    const loadLib = k32.declare("LoadLibraryW", W, P, ctypes.char16_t.ptr);
    const getProc = k32.declare("GetProcAddress", W, P, P, ctypes.char.ptr);
    const alloc = k32.declare("VirtualAlloc", W, P, P, ctypes.size_t, U32, U32);
    const protect = k32.declare("VirtualProtect", W, I, P, ctypes.size_t, U32, U32.ptr);
    const base = num(getModule("xul.dll"));
    const slot = base && delaySlot(base, "dwmapi.dll", "DwmExtendFrameIntoClientArea");
    const real = num(getProc(loadLib("dwmapi.dll"), "DwmExtendFrameIntoClientArea"));
    if (!slot || !real) return hook;
    const mem = num(alloc(null, 64, 0x3000, 0x40)); // MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE
    if (!mem) return hook;
    const margins = mem + 32;
    ctypes.cast(UP(margins), I.array(4).ptr).contents = [-1, -1, -1, -1];
    const code = [0x48, 0xba, ...le64(margins), 0x48, 0xb8, ...le64(real), 0xff, 0xe0]; // mov rdx, imm64; mov rax, imm64; jmp rax
    ctypes.cast(UP(mem), ctypes.uint8_t.array(code.length).ptr).contents = code;
    const write = v => {
      const old = new U32();
      protect(ctypes.cast(UP(slot), P), 8, 4, old.address()); // PAGE_READWRITE
      ctypes.cast(UP(slot), UP.ptr).contents = v;
      protect(ctypes.cast(UP(slot), P), 8, old.value, old.address());
    };
    hook = { orig: at(slot, UP), stub: UP(mem).value, write };
  } catch (e) { console.warn("Luminoctis: перехват стекла окна не подготовлен", e); hook = false; }
  return hook;
}

// hwnd — nativeHandle окна ("0x…"). true — подмена работает (иначе мод делает запасной вариант: возвращает стекло после отрисовок)
export function setGlass(hwnd, on) {
  on ? glass.add(String(hwnd)) : glass.delete(String(hwnd));
  const h = prepare();
  if (!h) return false;
  try { h.write(glass.size ? h.stub : h.orig); } catch (e) { console.warn("Luminoctis: перехват стекла окна", e); return false; }
  return true;
}
