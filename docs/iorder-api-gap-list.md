# iOrder API gap list

Flutter app abhi seedha Firestore use karti hai. Jahan orderapp ki API pehle se hai, wahan app us API ko call karegi. Jahan API nahi hai, woh yahan note rahegi. Database Firestore hi rahega.

Is file ko update karte raho: naya gap mile to row add karo. API ban jaye to status `API missing` se `API ready` karo. App mein lag jaye to `Integrated` karo.

Server (dev): `http://localhost:5020` (`npm run dev`, test Firestore).

## Auth

| Flow | User | App kya karti hai | API | Status | Note |
|---|---|---|---|---|---|
| Login | Admin | Phone + password, phir dashboard | `POST /auth/login` | Integrated | Session mein `user_id`, `user_type`, `tenant_id` save hota hai |
| Signup | Admin | Admin code `ADMIN123`, phir `users` mein account | `POST /auth/signup` | Integrated | Code server pe bhi check hota hai |
| Login | StoreKeeper | Phone + password, phir storekeeper home | `POST /auth/login` | Integrated | |
| Signup | StoreKeeper | Phone `storeKeepers` mein hona chahiye | `POST /auth/signup` | Integrated | Server yahi check karta hai |
| Signup | Outlet | Phone kisi outlet ka `primaryPhoneNumber` hona chahiye, `outletId` user par set | `POST /auth/signup` account banati hai, outlet link nahi karti | API missing | API `outletId` khali chhod deti hai |
| Login | Outlet | Login ke baad us phone ke saare outlets. Ek ho to seedha, kai hon to choose screen | `POST /auth/login` sirf user par likha ek `outletId` deti hai | API missing | Multi-outlet list API mein nahi hai |
| Signup | OutletStorekeeper | Pehle `outlet_storekeepers` mein `needsSignup: true` record, phir password set karke `users` mein account | Signup API `OutletStorekeeper` reject karti hai | API missing | |
| Login | OutletStorekeeper | Pehle `users`, nahi mila to purana `outlet_storekeepers` password | Login API sirf `users` dekhti hai | API missing | Purane accounts API se login nahi honge |

Outlet aur OutletStorekeeper abhi app mein seedha Firestore se chal rahe hain.

## Abhi API se nahi juda (baad ke modules)

In screens ki API orderapp mein hai, app abhi seedha Firestore call karti hai. Inhe tab integrate karenge jab auth wala hissa settle ho.

| Module | App | API |
|---|---|---|
| Products | List, add, edit, delete integrated | `GET/POST/PUT/DELETE /products` |
| Outlets | List, add, edit, delete integrated | `GET/POST /outlets`, `PATCH/DELETE /outlets/:id` |
| Orders | list, create, status, utensils on order | `/orders` |
| Returns | product returns | `/returns` |
| Payments | requests, approve, outlet summary | `/payments` |
| Storekeeper list | admin CRUD of store keepers | `/storekeepers` |
| Utensils | utensil master | `/utensils` |
| Chat | admin and outlet chat | `/chats` |
| Users | FCM token, profile update | `/nannu-users` |

Products: order place, delivered, aur cancel par quantity abhi Firestore se update hoti hai. Bulk upload/delete app use nahi karti. `sgst` nahi bheja jata.

Outlets: header `x-tenant-id` lagta hai. Outlet storekeeper list aur `clear-data` is step mein nahi hai. Orders aur payments ki outlet list abhi Firestore se aati hai.

## API missing, module baad mein confirm karna hai

| Flow | App collection | Note |
|---|---|---|
| Utensil return requests | `utensilReturnRequests` | Utensil master API hai. Return-request flow ki alag route nahi dikhi |
| Force update | `app_config/version` | App seedha Firestore padhti hai. Iske liye route nahi hai |
| FCM token after login | `users.fcmToken` | Login API body mein `fcmToken` le sakti hai. App token login ke baad alag se Firestore mein likhti hai |
