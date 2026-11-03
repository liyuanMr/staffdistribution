# -*- coding: utf-8 -*-
"""生成 map.pptx：交互地图启动 + 操作说明。

用法（Windows）：
    py -3.13 scripts/build-ppt.py
输出：项目根目录 map.pptx
依赖：python-pptx、scripts/ppt-assets/{national-map,panel}.png
"""
import os
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt, Emu

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "scripts" / "ppt-assets"
OUT = ROOT / "map.pptx"
EXE_REL = r"release\StaffDistributionMap-0.1.0.exe"

# 与网页端一致的科技深色主题
BG = RGBColor(0x05, 0x07, 0x0D)
PANEL = RGBColor(0x08, 0x13, 0x21)
PANEL2 = RGBColor(0x0B, 0x1A, 0x2A)
ACCENT = RGBColor(0x00, 0xE5, 0xFF)
TEXT = RGBColor(0xD6, 0xEC, 0xFF)
DIM = RGBColor(0x7E, 0xA6, 0xC4)
MUTED = RGBColor(0x4C, 0x6A, 0x84)
LINE = RGBColor(0x12, 0x3A, 0x50)
WHITE = RGBColor(0xF2, 0xFA, 0xFF)

FONT = "Microsoft YaHei"
MONO = "Consolas"
SLIDE_W = 13.333
SLIDE_H = 7.5


def set_font(run, size=14, color=TEXT, bold=False, font=FONT):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    # 同时设置东亚字体，避免中文回退成宋体
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = rPr.makeelement(qn("a:ea"), {})
        rPr.append(ea)
    ea.set("typeface", font)


def text(slide, x, y, w, h, content, size=14, color=TEXT, bold=False,
         font=FONT, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         line_spacing=None, space_after=0):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    lines = content if isinstance(content, (list, tuple)) else [content]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if line_spacing:
            p.line_spacing = line_spacing
        if space_after:
            p.space_after = Pt(space_after)
        run = p.add_run()
        run.text = line
        set_font(run, size, color, bold, font)
    return box


def rect(slide, x, y, w, h, fill=None, line=None, line_w=1.0, shape=MSO_SHAPE.RECTANGLE,
         radius=None, alpha=None):
    shp = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.shadow.inherit = False
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
        if alpha is not None:
            _set_alpha(shp, alpha)
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(line_w)
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        shp.adjustments[0] = radius
    shp.text_frame.text = ""
    return shp


def _set_alpha(shp, pct):
    """给纯色填充加透明度，pct 为 0-100（越大越透明）。"""
    try:
        solid = shp.fill._xPr.find(qn("a:solidFill"))
        srgb = solid.find(qn("a:srgbClr"))
        alpha = srgb.makeelement(qn("a:alpha"), {"val": str(int(pct * 1000))})
        srgb.append(alpha)
    except Exception:
        pass


def line(slide, x1, y1, x2, y2, color=LINE, width=1.0):
    from pptx.enum.shapes import MSO_CONNECTOR
    conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1),
                                      Inches(x2), Inches(y2))
    conn.line.color.rgb = color
    conn.line.width = Pt(width)
    return conn


def blank(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.background.fill
    bg.solid()
    bg.fore_color.rgb = BG
    return slide


def picture(slide, path, x, y, w, h):
    if not Path(path).exists():
        print("缺少图片：", path, file=sys.stderr)
        sys.exit(1)
    return slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))


def kicker(slide, label):
    text(slide, 0.8, 0.52, 8, 0.3, label, 10.5, ACCENT, True, MONO)


def title(slide, value, sub=None):
    text(slide, 0.8, 0.82, 11.7, 0.62, value, 30, WHITE, True)
    if sub:
        text(slide, 0.8, 1.36, 11.5, 0.4, sub, 12.5, DIM)


def footer(slide, value):
    text(slide, 0.8, 7.02, 11.7, 0.3, value, 9.5, MUTED)


def build():
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W)
    prs.slide_height = Inches(SLIDE_H)

    # ---------- 1. 封面 ----------
    s = blank(prs)
    picture(s, ASSETS / "national-map.png", 0, 0, SLIDE_W, SLIDE_H)
    rect(s, 0, 0, SLIDE_W, SLIDE_H, BG, alpha=52)

    text(s, 0.9, 1.62, 6.6, 0.35, "STAFF DISTRIBUTION MAP", 11, ACCENT, True, MONO)
    text(s, 0.9, 2.02, 7.2, 1.5, ["区域人员分布", "交互地图"], 42, WHITE, True,
         line_spacing=1.08)
    rect(s, 0.92, 3.92, 0.9, 0.045, ACCENT)
    text(s, 0.9, 4.18, 6.8, 0.95,
         ["全国 / 省 / 市三级下钻，北一区快捷视图", "设置地区人数、岗位与人员名单，一键保存并导出地图"],
         13.5, DIM, line_spacing=1.5)
    text(s, 0.9, 6.55, 6.6, 0.4, "map.pptx  ·  v0.1.0", 10, MUTED, False, MONO)

    # ---------- 2. 一键启动 ----------
    s = blank(prs)
    kicker(s, "LAUNCH")
    title(s, "一键启动交互地图", "点击按钮后由本地轻量服务打开默认浏览器，无需安装任何插件。")
    picture(s, ASSETS / "national-map.png", 0.55, 1.9, 7.2, 4.05)
    rect(s, 0.55, 1.9, 7.2, 4.05, None, line=LINE, line_w=0.75)

    card_x, card_y, card_w, card_h = 8.15, 1.9, 4.55, 4.05
    rect(s, card_x, card_y, card_w, card_h, PANEL, LINE, 0.75,
         MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.045)
    text(s, card_x + 0.3, card_y + 0.26, 3.9, 0.3, "启动方式", 11, DIM, True)

    btn = rect(s, card_x + 0.3, card_y + 0.66, 3.95, 0.95, ACCENT, None,
               shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.14)
    tf = btn.text_frame
    tf.word_wrap = True
    tf.margin_top = 0
    tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = "▶  启动交互地图"
    set_font(run, 18, BG, True)
    btn.click_action.hyperlink.address = EXE_REL

    text(s, card_x + 0.3, card_y + 1.78, 3.95, 0.55,
         "首次打开如出现安全提示，选择「运行」或「确定」。",
         10.5, MUTED, line_spacing=1.35)
    line(s, card_x + 0.3, card_y + 2.35, card_x + card_w - 0.3, card_y + 2.35, LINE, 0.75)

    text(s, card_x + 0.3, card_y + 2.52, 3.9, 0.28, "备用方式", 11, DIM, True)
    text(s, card_x + 0.3, card_y + 2.86, 3.95, 0.9,
         ["打开 release 文件夹，双击", "StaffDistributionMap-0.1.0.exe"],
         11.5, TEXT, line_spacing=1.4)
    text(s, card_x + 0.3, card_y + 3.62, 3.95, 0.3, "关闭黑色命令行窗口即停止服务", 9.5, MUTED)

    text(s, 0.8, 6.28, 11.7, 0.32,
         "运行后浏览器地址形如 http://127.0.0.1:随机端口/  ·  数据全部保存在本机",
         10.5, MUTED, False, MONO)
    footer(s, "保持 map.pptx 与 release 文件夹的相对位置不变，换电脑时请整体复制。")

    # ---------- 3. 操作步骤 ----------
    s = blank(prs)
    kicker(s, "HOW TO USE")
    title(s, "四步完成地区人员录入", "地图上的每个区域都可以独立维护人数、岗位和人员名单。")

    steps = [
        ("01", "启动", "点击上一页的启动按钮，或双击 release 下的 exe，\n浏览器会自动打开地图页面。"),
        ("02", "选地区", "点击地图中的省份；顶部「北一区」可只看北京、天津、\n河北、内蒙古与东三省。"),
        ("03", "录数据", "右侧「人员」页填写当前地区人数、岗位及人数、人员名单\n（姓名 / 岗位 / 电话）。"),
        ("04", "保存", "点击「保存到本地」持久化；「导出图片」生成 2 倍分辨率\nPNG，可直接插回 PPT。"),
    ]
    y = 1.88
    for num, name, desc in steps:
        rect(s, 0.8, y, 0.56, 0.56, None, ACCENT, 1.0,
             MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.18)
        text(s, 0.8, y + 0.12, 0.56, 0.3, num, 13, ACCENT, True, MONO, PP_ALIGN.CENTER)
        text(s, 1.56, y - 0.02, 4.3, 0.32, name, 15, WHITE, True)
        text(s, 1.56, y + 0.35, 5.0, 0.62, desc, 11, DIM, line_spacing=1.35)
        y += 1.18

    picture(s, ASSETS / "panel.png", 6.85, 1.88, 6.0, 3.375)
    rect(s, 6.85, 1.88, 6.0, 3.375, None, line=LINE, line_w=0.75)
    text(s, 6.85, 5.34, 6.0, 0.3, "人员页：当前地区人数 / 岗位 / 人员名单", 10, MUTED)

    rect(s, 6.85, 5.86, 6.0, 0.72, PANEL2, LINE, 0.75, MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08)
    text(s, 7.1, 6.06, 5.55, 0.36,
         "提示：标注默认常显在地图上；也可切换为「点击气泡」，让地图更清爽。",
         10.5, DIM)

    # ---------- 4. 数据与说明 ----------
    s = blank(prs)
    kicker(s, "DATA & NOTES")
    title(s, "数据保存在哪里", "所有修改都写入本地 JSON，不经过任何服务器，断网也能用。")

    cards = [
        ("运行 exe 时", r"%APPDATA%\StaffDistributionMap\region-config.json",
         "保存后写入该文件；替换或重新打包 exe 都不会丢失数据。"),
        ("开发模式", r"public\data\region-config.json",
         "运行 npm run serve 时读写项目内配置，可直接用编辑器修改。"),
    ]
    x = 0.8
    for name, path, desc in cards:
        rect(s, x, 1.92, 5.75, 1.85, PANEL, LINE, 0.75, MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
        text(s, x + 0.32, 2.13, 5.0, 0.3, name, 11, DIM, True)
        text(s, x + 0.32, 2.48, 5.15, 0.34, path, 11.5, ACCENT, False, MONO)
        text(s, x + 0.32, 2.94, 5.1, 0.62, desc, 10.5, MUTED, line_spacing=1.35)
        x += 6.0

    text(s, 0.8, 4.18, 8, 0.3, "关于 PowerPoint 交互", 13, ACCENT, True)
    notes = [
        ("桌面版 PowerPoint 不能内嵌真正的网页与交互地图。", "本方案用按钮唤起本地服务，在默认浏览器中完成操作。"),
        ("演示前把 pptx 与 release 文件夹一起复制。", "超链接使用相对路径，分开后按钮会失效。"),
        ("浏览器中按 F11 进入全屏演示。", "关闭命令行窗口即退出服务；再次演示重新启动即可。"),
    ]
    y = 4.62
    for head, tail in notes:
        rect(s, 0.86, y + 0.09, 0.12, 0.12, ACCENT)
        text(s, 1.2, y, 11.2, 0.3, head, 12, TEXT, True)
        text(s, 1.2, y + 0.34, 11.2, 0.3, tail, 10.5, MUTED)
        y += 0.78

    footer(s, "提示：如需把最新地图放进 PPT，请先在网页中「导出图片」，再插入到幻灯片。")

    prs.save(str(OUT))
    print("已生成：", OUT)
    print("幻灯片数：", len(prs.slides))


if __name__ == "__main__":
    build()
