# -*- coding: utf-8 -*-
"""内置普惠体子集化：GB2312 全汉字 + ASCII + 常用符号区 → woff2
缺字时 Canvas 字体栈逐字回退「Microsoft YaHei UI」，水印场景不会开天窗。
用法: python tools/subset_fonts.py   （原文件备份到 fonts/full-backup/）
"""
import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'fonts')
BACKUP = os.path.join(FONTS, 'full-backup')

def charset_text():
    chars = set()
    # ASCII 可打印区
    for c in range(0x20, 0x7F):
        chars.add(chr(c))
    # GB2312 全区：符号(A1-A9) + 汉字一级(B0-D7) + 二级(D8-F7)
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode('gb2312')
                chars.add(ch)
            except UnicodeDecodeError:
                pass
    # 补充常用符号（度、乘、约等 latin-1）
    for ch in '°×÷±©®™·…—–‹›«»„“”‘’†‡‰℃℉':
        chars.add(ch)
    return ''.join(sorted(chars))

def main():
    os.makedirs(BACKUP, exist_ok=True)
    txt = os.path.join(FONTS, 'subset-chars.txt')
    with io.open(txt, 'w', encoding='utf-8') as f:
        f.write(charset_text())
    n_chars = sum(1 for _ in io.open(txt, encoding='utf-8').read())
    print(f'字符集 {n_chars} 个')

    total_old = total_new = 0
    for w in (400, 500, 600, 700):
        name = f'PuHuiTi-{w}.woff2'
        src = os.path.join(FONTS, name)
        dst = os.path.join(FONTS, name + '.subset')
        subprocess.run([
            sys.executable, '-m', 'fontTools.subset', src,
            f'--output-file={dst}', '--flavor=woff2',
            f'--text-file={txt}',
            '--layout-features=*', '--desubroutinize',
            '--drop-tables+=FFTM',
        ], check=True)
        old, new = os.path.getsize(src), os.path.getsize(dst)
        total_old += old; total_new += new
        print(f'{name}: {old/1048576:.2f}MB -> {new/1048576:.2f}MB')
        # 备份原文件后替换
        bak = os.path.join(BACKUP, name)
        if not os.path.exists(bak):
            os.replace(src, bak)
        else:
            os.remove(src)
        os.replace(dst, src)
    print(f'合计: {total_old/1048576:.2f}MB -> {total_new/1048576:.2f}MB（省 {(total_old-total_new)/1048576:.2f}MB）')
    os.remove(txt)

if __name__ == '__main__':
    main()
