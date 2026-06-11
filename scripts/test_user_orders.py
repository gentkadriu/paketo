"""Test real order IDs from user batch."""
import json
from app.aks_client import track_order, reset_session
from app.status import categorize_aks_status, label_for

ORDERS = [
    ("91748000346507", "Aleksandar Stefanović", "UNET POVRAT"),
    ("91766000346509", "Tamás Kovács", "delivered 06.01"),
    ("91774000346511", "Žikica Stanojlović", "delivered 08.01"),
    ("91741000346513", "Slaviša Medojević", "delivered 09.01"),
    ("91752000346515", "Elvis Murselji", "delivered 08.01"),
    ("91762000346517", "Emran Alija", "Vraceno u magacin"),
    ("91780000346519", "Dragoslav Mijatović", "delivered 06.01"),
    ("91793000346521", "Bojan Karić", "Na isporuci"),
    ("91760000346523", "Slavko Savić", "Vraceno u magacin"),
    ("91757000346508", "Slave Boskovski", "delivered 06.01"),
    ("91793000346512", "Stojan Pešić", "Unet povrat"),
    ("91760000346510", "Milivoje Marković", "unet povrat"),
    ("91723000346514", "Slavoljub Milovanović", "delivered 09.01"),
    ("91794000346516", "Srećko Đorđević", "delivered 06.01"),
    ("91771000346518", "Srđan Simonović", "Na isporuci"),
    ("91779000346520", "Dejan Banović", "delivered 09.01"),
    ("91712000346522", "Milan Ribić", "delivered 09.01"),
    ("91739000346488", "Nikola Đorđević", "delivered 08.01"),
    ("91762000346486", "Dejan Đorđev", "Vraceno u magacin"),
    ("91791000346484", "Dalibor Dražić", "delivered 06.01"),
    ("91730000346487", "Srđan Stojanović", "delivered 06.01"),
    ("91720000346485", "Zoran Mihajlović", "delivered 06.01"),
    ("91709000346483", "Mirsad Haliti", "delivered 06.01"),
    ("91742000346481", "Enes Mujović", "delivered 06.01"),
]

reset_session()
print(f"{'ID':<16} {'Category':<18} {'Latest AKS status':<35} Note")
print("-" * 100)

for oid, name, note in ORDERS:
    try:
        r = track_order(oid)
        cat = categorize_aks_status(r["status"])
        print(f"{oid} {label_for(cat):<18} {r['status'][:34]:<35} {note}")
    except Exception as e:
        print(f"{oid} {'ERROR':<18} {str(e)[:34]:<35} {note}")
