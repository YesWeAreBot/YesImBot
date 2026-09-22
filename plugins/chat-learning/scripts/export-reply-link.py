#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export-reply-link.py：训练并导出 chat-learning links.ts 用的回复边打分 MLP。

任务（对齐真实回复结构）：给定消息对 (X, Y)，Y 在 X 前 W 条窗口内，预测"X 是否回复 Y"。
  —— 不用"仅相邻"，因为实测回复距离中位 7 条（实验 65）。
监督：显式 quote/@ 边 = 正例；同窗口随机对 = 负例（平衡采样）。
特征（4 维）：[same_speaker, bigram_overlap, log10(1+Δt秒), log10(1+位置距)]

导出：data/yesimbot/reply-link-model.json（MLP 4→64→1）
"""
import sqlite3, re, random, json, math
from collections import defaultdict
import numpy as np
import torch, torch.nn as nn

torch.set_num_threads(8)
torch.manual_seed(42); random.seed(42); np.random.seed(42)

W = 10
HID = 64
EPOCHS = 5
BATCH = 512
BASE = '/home/yurikale/koishi-app/data'

def clean(t):
    t = re.sub(r'\[[^\]]+\]', ' ', t or '')
    t = re.sub(r'@[\w·\-]+', ' ', t)
    return re.sub(r'[^\u4e00-\u9fa5A-Za-z0-9]', '', t)

def bigrams(t):
    t = clean(t)
    return {t[i:i+2] for i in range(len(t)-1)}

def load(path, ch):
    db = sqlite3.connect(path)
    rows = db.execute("SELECT id, message_id, user_id, is_bot, text, timestamp FROM messages WHERE channel_id=? ORDER BY id", (ch,)).fetchall()
    men = db.execute("SELECT m.message_id, m.target_user_id FROM mentions m JOIN messages g ON g.id=m.message_id WHERE g.channel_id=?", (ch,)).fetchall()
    quo = db.execute("SELECT q.message_id, q.replied_message_id FROM quotes q JOIN messages g ON g.id=q.message_id WHERE g.channel_id=?", (ch,)).fetchall()
    db.close()
    pid2row = {}
    for r in rows:
        if r[1]:
            pid2row.setdefault(r[1], r[0])
    mentions = defaultdict(set)
    for mid, tgt in men:
        if tgt and tgt != 'all':
            mentions[mid].add(tgt)
    quotes = {}
    for mid, rid in quo:
        to = pid2row.get(rid)
        if to is not None and to != mid:
            quotes[mid] = to
    return [r for r in rows if not r[3]], mentions, quotes

def build(human, mentions, quotes, limit):
    uids = sorted({r[2] for r in human})
    uid2spk = {u: i for i, u in enumerate(uids)}
    row2idx = {r[0]: i for i, r in enumerate(human)}
    bg = [bigrams(r[4]) for r in human]
    ts = [r[5] for r in human]
    pos, neg = [], []
    for i, r in enumerate(human):
        if len(pos) >= limit:
            break
        tgt = quotes.get(r[0])
        tgt_idx = row2idx.get(tgt) if tgt is not None else None
        if tgt_idx is None or tgt_idx >= i:
            tgt_idx = None
            tgt_uids = mentions.get(r[0])
            if tgt_uids:
                for j in range(i-1, max(-1, i-10), -1):
                    if human[j][2] in tgt_uids:
                        tgt_idx = j; break
        if tgt_idx is None:
            continue
        j = tgt_idx
        pos.append([1 if human[i][2] == human[j][2] else 0,
                    len(bg[i] & bg[j]) / max(1, len(bg[i] | bg[j])),
                    math.log10(max(1, (ts[i]-ts[j])//1000) + 1),
                    math.log10((i-j) + 1)])
        lo = max(0, i - W)
        cands = [k for k in range(lo, i) if k != j]
        for k in random.sample(cands, min(2, len(cands))):
            neg.append([1 if human[i][2] == human[k][2] else 0,
                        len(bg[i] & bg[k]) / max(1, len(bg[i] | bg[k])),
                        math.log10(max(1, (ts[i]-ts[k])//1000) + 1),
                        math.log10((i-k) + 1)])
    return pos, neg

def main():
    human1, m1, q1 = load('/tmp/full.db', 'imported')
    human2, m2, q2 = load('/tmp/huli.db', '717532590')
    pos, neg = [], []
    p1, n1 = build(human1, m1, q1, 60000)
    p2, n2 = build(human2, m2, q2, 60000)
    pos = p1 + p2; neg = n1 + n2
    print(f'正例 {len(pos)} | 负例 {len(neg)}', flush=True)
    n = min(len(pos), len(neg))
    random.shuffle(neg); neg = neg[:n]
    X = torch.tensor(pos + neg, dtype=torch.float32)
    y = torch.tensor([1]*len(pos) + [0]*len(neg), dtype=torch.float32)

    idx = np.random.permutation(len(y)); sp = int(len(idx)*0.85)
    tr, va = idx[:sp], idx[sp:]

    model = nn.Sequential(nn.Linear(4, HID), nn.ReLU(), nn.Dropout(0.2), nn.Linear(HID, 1))
    opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-5)
    lossf = nn.BCEWithLogitsLoss()
    for ep in range(EPOCHS):
        model.train(); perm = np.random.permutation(len(tr))
        for b in range(0, len(perm), BATCH):
            bi = perm[b:b+BATCH]
            opt.zero_grad(); lossf(model(X[bi]).squeeze(-1), y[bi]).backward(); opt.step()
        model.eval()
        with torch.no_grad():
            p = torch.sigmoid(model(X[va]).squeeze(-1)).numpy()
        yv = y[va].numpy()
        order = np.argsort(p); rs = sum(rank+1 for rank, ix in enumerate(order) if yv[ix])
        n1 = int(yv.sum()); n0 = len(yv)-n1
        print(f'epoch{ep} val AUC={(rs-n1*(n1+1)/2)/(n1*n0):.4f}', flush=True)

    state = model.state_dict()
    export = {
        'fc.0.weight': state['0.weight'].numpy().tolist(),
        'fc.0.bias': state['0.bias'].numpy().tolist(),
        'fc.3.weight': state['3.weight'].numpy().tolist(),
        'fc.3.bias': state['3.bias'].numpy().tolist(),
        '_meta': {'dim': 4, 'hidden': HID, 'feat_names': ['same_speaker', 'bigram_overlap', 'log_time_gap', 'log_pos_dist']},
    }
    import os
    os.makedirs(f'{BASE}/yesimbot', exist_ok=True)
    out = f'{BASE}/yesimbot/reply-link-model.json'
    json.dump(export, open(out, 'w'), ensure_ascii=False)
    print(f'导出 → {out}', flush=True)

    with torch.no_grad():
        p = torch.sigmoid(model(X[va]).squeeze(-1)).numpy()
    print('阈值校准（验证集）:', flush=True)
    for th in [0.3, 0.5, 0.6, 0.7]:
        pred = (p >= th).astype(int)
        tp = ((pred==1)&(yv==1)).sum(); fp = ((pred==1)&(yv==0)).sum(); fn = ((pred==0)&(yv==1)).sum()
        pr = tp/(tp+fp) if tp+fp else 0; rc = tp/(tp+fn) if tp+fn else 0
        print(f'  th={th}: prec={pr:.3f} rec={rc:.3f} F1={2*pr*rc/(pr+rc) if pr+rc else 0:.3f}', flush=True)

if __name__ == '__main__':
    main()
