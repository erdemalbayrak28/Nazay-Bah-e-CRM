from fastapi import FastAPI, HTTPException, Query, Path, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Date, Text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from datetime import date, datetime, timedelta
from typing import Optional, List
import os
import secrets
import sqlalchemy
from dotenv import load_dotenv
from jose import JWTError, jwt

# --- Auth Setup ---
SECRET_KEY = os.getenv("SECRET_KEY", "nazay-bahce-super-gizli-anahtar-2024")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

VALID_USERNAME = "nazaybahce"
VALID_PASSWORD = "1624nazay"

security = HTTPBearer()

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Geçersiz token")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="Geçersiz veya süresi dolmuş token")

class LoginRequest(BaseModel):
    username: str
    password: str


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./database.db")

# Railway PostgreSQL URL'leri "postgres://" ile başlar, SQLAlchemy "postgresql://" ister
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# PostgreSQL için check_same_thread parametresi gerekmez
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Customer(Base):
    __tablename__ = "customers"
    
    id = Column(Integer, primary_key=True, index=True)
    ad_soyad = Column(String, index=True)
    telefon = Column(String)
    kaynak = Column(String, index=True)
    durum = Column(String, index=True)
    etkinlik_tarihi = Column(Date, nullable=True)
    etkinlik_adi = Column(String, index=True, nullable=True)
    toplam_fiyat = Column(Integer, default=0)
    alinan_avans = Column(Integer, default=0)
    alinan_odeme = Column(Integer, default=0)
    kisi_sayisi = Column(Integer, nullable=True)
    notlar = Column(Text, nullable=True)

Base.metadata.create_all(bind=engine)

# Migration: Add etkinlik_adi if it doesn't exist
try:
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text("ALTER TABLE customers ADD COLUMN etkinlik_adi VARCHAR"))
        conn.commit()
except Exception:
    pass # Column already exists

# Migration: Add financial columns if they don't exist
try:
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text("ALTER TABLE customers ADD COLUMN toplam_fiyat INTEGER DEFAULT 0"))
        conn.commit()
except Exception:
    pass

try:
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text("ALTER TABLE customers ADD COLUMN alinan_avans INTEGER DEFAULT 0"))
        conn.commit()
except Exception:
    pass

try:
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text("ALTER TABLE customers ADD COLUMN alinan_odeme INTEGER DEFAULT 0"))
        conn.commit()
except Exception:
    pass

try:
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text("ALTER TABLE customers ADD COLUMN kisi_sayisi INTEGER"))
        conn.commit()
except Exception:
    pass

# --- Pydantic Models ---
class CustomerBase(BaseModel):
    ad_soyad: str
    telefon: str
    kaynak: str
    durum: str
    etkinlik_adi: Optional[str] = None
    etkinlik_tarihi: Optional[date] = None
    toplam_fiyat: Optional[int] = 0
    alinan_avans: Optional[int] = 0
    alinan_odeme: Optional[int] = 0
    kisi_sayisi: Optional[int] = None
    notlar: Optional[str] = None

class CustomerCreate(CustomerBase):
    pass

class CustomerResponse(CustomerBase):
    id: int
    
    class Config:
        orm_mode = True
        from_attributes = True

# --- FastAPI App ---
app = FastAPI(title="Nazay Bahçe CRM API")

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# API Endpoints
@app.post("/api/login")
def login(request: LoginRequest):
    username_ok = secrets.compare_digest(request.username, VALID_USERNAME)
    password_ok = secrets.compare_digest(request.password, VALID_PASSWORD)
    if not (username_ok and password_ok):
        raise HTTPException(status_code=401, detail="Kullanıcı adı veya şifre hatalı")
    token = create_access_token({"sub": request.username})
    return {"access_token": token, "token_type": "bearer"}

@app.post("/api/customers", response_model=CustomerResponse)
def create_customer(customer: CustomerCreate, current_user: str = Depends(verify_token)):
    db: Session = SessionLocal()
    db_customer = Customer(**customer.model_dump())
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    db.close()
    return db_customer

@app.get("/api/customers", response_model=List[CustomerResponse])
def get_customers(kaynak: Optional[str] = None, durum: Optional[str] = None, etkinlik_adi: Optional[str] = None, current_user: str = Depends(verify_token)):
    db: Session = SessionLocal()
    query = db.query(Customer)
    if kaynak:
        query = query.filter(Customer.kaynak == kaynak)
    if durum:
        query = query.filter(Customer.durum == durum)
    if etkinlik_adi:
        query = query.filter(Customer.etkinlik_adi == etkinlik_adi)
    customers = query.all()
    db.close()
    return customers

@app.get("/api/customers/{customer_id}", response_model=CustomerResponse)
def get_customer(customer_id: int, current_user: str = Depends(verify_token)):
    db: Session = SessionLocal()
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    db.close()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer

@app.put("/api/customers/{customer_id}", response_model=CustomerResponse)
def update_customer(customer_id: int, customer: CustomerCreate, current_user: str = Depends(verify_token)):
    db: Session = SessionLocal()
    db_customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if db_customer is None:
        db.close()
        raise HTTPException(status_code=404, detail="Customer not found")
    
    update_data = customer.model_dump()
    for key, value in update_data.items():
        setattr(db_customer, key, value)
    
    db.commit()
    db.refresh(db_customer)
    db.close()
    return db_customer

@app.delete("/api/customers/{customer_id}")
def delete_customer(customer_id: int, current_user: str = Depends(verify_token)):
    db: Session = SessionLocal()
    db_customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if db_customer is None:
        db.close()
        raise HTTPException(status_code=404, detail="Customer not found")
    
    db.delete(db_customer)
    db.commit()
    db.close()
    return {"message": "Customer deleted successfully"}

# Mount Static Files (Ensure 'static' folder exists)
# For SPA routing, we catch everything else and return index.html
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    return FileResponse("static/index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

