import fitz, sys

# Force stdout to use UTF-8
sys.stdout.reconfigure(encoding='utf-8')

doc = fitz.open(r'C:/Users/keiichi/.gemini/antigravity/brain/40d96849-83f3-4194-b0c4-6ab8c1b14067/.tempmediaStorage/ceb4d8817d462b01.pdf')
for i, page in enumerate(doc):
    text = page.get_text()
    print(f'\n=== PAGE {i+1} ===')
    print(text)
