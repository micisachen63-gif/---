import sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'private/font-tools'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset
font=TTFont(root/'assets/NotoSansTC.ttf')
font=instantiateVariableFont(font,{'wght':400},inplace=True)
options=subset.Options();options.flavor='woff2';options.desubroutinize=True
sub=subset.Subsetter(options=options)
sub.populate(unicodes=list(range(0x20,0x100))+list(range(0x2000,0x2070))+list(range(0x3000,0x3100))+list(range(0x3400,0x9fff))+list(range(0xff00,0xfff0)))
sub.subset(font);font.flavor='woff2';font.save(root/'assets/noto-sans-tc.woff2')
print('Prepared Noto Sans TC webfont:',(root/'assets/noto-sans-tc.woff2').stat().st_size,'bytes')
