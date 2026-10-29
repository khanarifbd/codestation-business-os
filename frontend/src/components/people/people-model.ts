export type Person = {
 id:string; full_name:string; login_email:string; employee_code:string; role_name:string; membership_status:string;
 department_id:string|null; department_name:string|null; designation_id:string|null; designation_name:string|null; manager_employee_id:string|null;
 work_email:string|null; phone:string|null; work_phone:string|null; employment_type:string; employment_status:string; join_date:string|null; end_date:string|null; work_location:string|null; notes:string|null;
};
export type NamedOption={id:string;name:string;code?:string|null};
export type InviteRole={id:string;name:string;slug:string};
export type Invitation={id:string;email:string;full_name:string;employee_code:string;role_name:string;expires_at:string};
export type PeopleBundle={people:Person[];departments:NamedOption[];designations:NamedOption[];invite_roles:InviteRole[];invitations:Invitation[];capabilities:{can_manage_people:boolean;can_invite_employees:boolean;can_manage_structure:boolean}};
export type PeopleView="directory"|"structure"|"invitations";
export type PeopleBrowse={view:PeopleView;search:string;focus:string};
export type PeopleMode="register"|"profile"|"edit"|"invite"|"structure";
export type StructureKind="department"|"designation";
export type InviteAction="copy"|"resend"|"revoke";
export type PeopleValues=Record<string,string>;
export const EMPLOYMENT_TYPES=["full_time","part_time","contract","internship","temporary"] as const;
export const PERSON_FIELDS=["department_id","designation_id","manager_employee_id","work_email","phone","work_phone","employment_type","join_date","end_date","work_location","notes"] as const;
export const INVITE_FIELDS=["full_name","email","role_id","department_id","designation_id","employee_code"] as const;
export function peopleLabel(value:string){return value.replaceAll("_"," ");}
export function peopleInitialValues(mode:PeopleMode,person:Person|null):PeopleValues{
 if(mode==="edit")return Object.fromEntries(PERSON_FIELDS.map(key=>[key,person?.[key]??(key==="employment_type"?"full_time":"")]));
 return Object.fromEntries((mode==="invite"?INVITE_FIELDS:["name","code","description"]).map(key=>[key,""]));
}
export function filterPeople(rows:Person[],search:string){const q=search.trim().toLowerCase();return !q?rows:rows.filter(p=>`${p.full_name} ${p.employee_code} ${p.login_email} ${p.work_email??""} ${p.department_name??""} ${p.designation_name??""} ${p.role_name} ${p.work_location??""}`.toLowerCase().includes(q));}
export function peoplePayload(mode:PeopleMode,values:PeopleValues){
 const value=(key:string)=>String(values[key]??"").trim();const nullable=(key:string)=>value(key)||null;
 if(mode==="edit"){
  if(value("join_date")&&value("end_date")&&value("end_date")<value("join_date"))throw new Error("End date cannot be before join date.");
  if(value("phone").length>64||value("work_phone").length>64)throw new Error("Phone numbers must be 64 characters or fewer.");
  if(value("work_location").length>180)throw new Error("Work location must be 180 characters or fewer.");
  return Object.fromEntries(PERSON_FIELDS.map(key=>[key,key==="employment_type"?value(key)||"full_time":nullable(key)]));
 }
 if(mode==="invite"){
  if(value("full_name").length<2||value("full_name").length>160||!value("email")||!value("role_id"))throw new Error("A 2–160 character name, email and an allowed employee role are required.");
  if(value("employee_code").length>40)throw new Error("Employee code must be 40 characters or fewer.");
  return Object.fromEntries(INVITE_FIELDS.map(key=>[key,["full_name","email","role_id"].includes(key)?value(key):nullable(key)]));
 }
 if(mode!=="structure")throw new Error("This workspace is read-only.");
 if(value("name").length<2||value("name").length>120)throw new Error("Name must be 2–120 characters.");
 if(value("code").length>24||value("description").length>500)throw new Error("Use at most 24 characters for the code and 500 for the description.");
 return {name:value("name"),code:nullable("code"),description:nullable("description")};
}
function object(v:unknown):v is Record<string,unknown>{return typeof v==="object"&&v!==null;}
export function isPeopleBundle(value:unknown):value is PeopleBundle{
 if(!object(value)||!object(value.capabilities))return false;
 const capabilities=value.capabilities;
 if(!["can_manage_people","can_invite_employees","can_manage_structure"].every(k=>typeof capabilities[k]==="boolean"))return false;
 if(!["people","departments","designations","invite_roles","invitations"].every(k=>Array.isArray(value[k])))return false;
 const rows=value.people as unknown[];
 return rows.every(p=>object(p)&&["id","full_name","login_email","employee_code","role_name","membership_status","employment_type","employment_status"].every(k=>typeof p[k]==="string")&&PERSON_FIELDS.filter(k=>k!=="employment_type").every(k=>p[k]===null||typeof p[k]==="string"))
 &&(value.departments as unknown[]).concat(value.designations as unknown[],value.invite_roles as unknown[]).every(p=>object(p)&&typeof p.id==="string"&&typeof p.name==="string")
 &&(value.invitations as unknown[]).every(p=>object(p)&&["id","email","full_name","employee_code","role_name","expires_at"].every(k=>typeof p[k]==="string"));
}
