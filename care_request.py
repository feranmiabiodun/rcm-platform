import json
import os
from pymongo import MongoClient

# Load Mongo URI from environment variable
mongo_uri = os.getenv("MONGO_DB_CONNECTION_STRING")

# Connect to MongoDB
client = MongoClient(mongo_uri)
db = client["MONGO_DB_BACKEND"]

# Load eligibility.json
with open("eligibility.json", "r") as f:
    data = json.load(f)

# Insert into care_request_initiation collection
if isinstance(data, list):
    result = db["care_request_initiation"].insert_many(data)
    print(f"Inserted {len(result.inserted_ids)} documents into care_request_initiation.")
else:
    result = db["care_request_initiation"].insert_one(data)
    print("Inserted 1 document into care_request_initiation.")
