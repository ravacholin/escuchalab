
import React from 'react';
import { Level, TextType } from '../types';
import {
    // Generic Icons
    MapPin, Hand, HelpCircle, AlertCircle, AlertTriangle, MessageCircle, Heart, Angry, Search, Smile, Zap, DollarSign, Frown, Scale, Star, ThumbsUp, ThumbsDown, Camera,
    // Scenario Specific Icons
    Coffee, Bed, Car, ShoppingBag, Train, Home, Pill, Plane, Utensils, Bus, School, Landmark,
    Stethoscope, ShieldAlert, Briefcase, Wallet, Wrench, Dumbbell, Key, Scissors, Phone, Laptop,
    Palette, Gavel, FlaskConical, Globe, Wine, Mic, Brain, Tv, Drama, Ghost, Rocket, Megaphone, Sun, Umbrella, Music,
    // Action Icons
    Ticket, Receipt, Menu, Wifi, Clock, Lock, Thermometer, BriefcaseBusiness, UserPlus, FileWarning, Gift, Sparkles, AlertOctagon, Euro, CreditCard, Map, Flag, Download,
    // Missing Icons Fix
    Check, X, TrendingUp, CheckCircle, FileText, Ban, Apple, DoorOpen, Server, Lightbulb, BatteryLow, PieChart, Eye, Watch, GraduationCap,
    // New Additions
    Stamp, Popcorn, Building, HeartHandshake, Baby, Dog, Hammer, Film, BookOpen, Siren, Headphones, Guitar, Newspaper, Tent, Hash,
    ArrowRight, Calendar, Droplet, FireExtinguisher, Leaf, LineChart, ListChecks, Moon, PiggyBank, Recycle, Shirt, Ship, Trash2, TreePine, Truck
} from 'lucide-react';

export interface ScenarioAction {
    label: string;
    value: string; // The specific prompt for the AI
    icon: React.ElementType;
}

export interface ScenarioContext {
    label: string;
    value: string; // The physical setting description
    registerInstruction: string; // Precise register/formality guidance for the scenario
    icon: React.ElementType;
    actions: ScenarioAction[]; // CHILDREN ACTIONS specific to this place
}

export const SCENARIO_DATABASE: Record<TextType, Record<Level, ScenarioContext[]>> = {
    [TextType.Dialogue]: {
        [Level.Intro]: [
            {
                label: "Datos de Contacto",
                value: "Intercambio de información personal social ruido ambiente",
                registerInstruction: "Registro social informal y cortés. Tratamiento: tú. Frases breves y claras para pedir, confirmar y repetir datos. Evitar lunfardo fuerte, insultos o bromas.",
                icon: Phone,
                actions: [
                    { label: "Número de WhatsApp", value: "Pedir y anotar un número de teléfono. UNO de los hablantes dicta los dígitos lentamente o agrupados.", icon: Hash },
                    { label: "Correo Electrónico", value: "Dictar un email complejo (arroba, punto, guion bajo).", icon: MessageCircle },
                    { label: "Usuario de Instagram", value: "Preguntar cómo aparece en redes sociales y deletrear el usuario.", icon: Search }
                ]
            },
            {
                label: "Recepción de Hotel",
                value: "Recepción hotel check-in formal mostrador",
                registerInstruction: "Registro formal de atención al cliente. Tratamiento: usted. Fórmulas de cortesía (buenos días, por favor, gracias). Prohibido coloquialismos, jerga o sarcasmo.",
                icon: Bed,
                actions: [
                    { label: "Deletrear Apellido", value: "El recepcionista no entiende el apellido y pide deletrearlo letra por letra.", icon: FileText },
                    { label: "Número de Habitación", value: "Asignar una habitación (ej: 304, 512) y dar instrucciones del piso.", icon: Key },
                    { label: "Horario Desayuno", value: "Informar de la hora exacta del desayuno (de 7:30 a 10:00).", icon: Clock }
                ]
            },
            {
                label: "Compras y Dinero",
                value: "Tienda caja pagar ruido supermercado",
                registerInstruction: "Registro de servicio en caja: formal neutro, tratamiento usted, confirmaciones de precio y cambio. Sin lunfardo, sin diminutivos excesivos, sin bromas.",
                icon: Wallet,
                actions: [
                    { label: "Precio Exacto", value: "El cajero dice el total con céntimos (ej: 14,95€) y el cliente busca cambio.", icon: Euro },
                    { label: "Número de Zapato/Ropa", value: "Pedir una talla específica (38, 42, XL) y preguntar si hay.", icon: ShoppingBag },
                    { label: "Devolución (Días)", value: "Preguntar cuántos días hay para devolver (15 días, 30 días).", icon: Clock }
                ]
            },
            {
                label: "Transporte / Ciudad",
                value: "Calle taxi parada autobús ruido tráfico",
                registerInstruction: "Registro urbano funcional y cortés. Tratamiento usted con desconocidos; instrucciones directas. Evitar jerga local demasiado marcada, insultos o chistes.",
                icon: Car,
                actions: [
                    { label: "Dirección Exacta", value: "Decir al taxista la calle y el número exacto del portal.", icon: MapPin },
                    { label: "Número de Autobús", value: "Preguntar qué número de bus va al centro (el 24, el 132).", icon: Bus },
                    { label: "Distancia / Tiempo", value: "Preguntar cuánto falta (10 minutos, 5 kilómetros).", icon: Watch }
                ]
            },
            {
                label: "Citas y Agenda",
                value: "Oficina administración teléfono cita médica",
                registerInstruction: "Registro administrativo formal. Tratamiento: usted. Lenguaje preciso para fechas y horarios. Prohibido coloquialismos, muletillas y familiaridad.",
                icon: Clock,
                actions: [
                    { label: "Fecha de Nacimiento", value: "Dar la fecha de nacimiento para un formulario (día, mes, año).", icon: FileText },
                    { label: "Reservar Hora", value: "Acordar una cita para un día específico a una hora concreta.", icon: Clock },
                    { label: "Código Postal", value: "Dictar el código postal de la dirección.", icon: Hash }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Cafetería / Restaurante",
                value: "Cafetería restaurante bar ruidoso servicio mesa",
                registerInstruction: "Registro de atención en restaurante: cortés y semi-formal. Cliente trata de usted al camarero, peticiones claras. Evitar jerga fuerte o insultos.",
                icon: Coffee,
                actions: [
                    { label: "Pedir la Cuenta", value: "Cliente pide la cuenta y pregunta si aceptan tarjeta", icon: Receipt },
                    { label: "Reclamar (Comida Fría)", value: "El plato ha llegado frío y el cliente pide cambiarlo", icon: AlertCircle },
                    { label: "Preguntar Ingredientes", value: "Preguntar qué lleva un plato por alergia o gusto", icon: Menu },
                    { label: "Pedir Recomendación", value: "No sabe qué pedir y pregunta al camarero qué es bueno", icon: HelpCircle },
                    { label: "Pedir Mesa (Reserva)", value: "Llegar al local y preguntar si hay mesa libre para dos", icon: UserPlus },
                    { label: "Pedir Agua/Pan", value: "Solicitar más agua, pan o servilletas", icon: Hand },
                    { label: "Preguntar Ubicación Baño", value: "Preguntar educadamente dónde están los servicios", icon: MapPin },
                    { label: "Pedir para Llevar", value: "Sobró comida y quiere una caja para llevársela", icon: ShoppingBag },
                    { label: "Café con Leche", value: "Pedir un café específico (con leche, cortado, solo)", icon: Coffee },
                    { label: "Error en la Cuenta", value: "Han cobrado algo que no han pedido", icon: AlertTriangle }
                ]
            },
            {
                label: "Mercado Callejero",
                value: "Mercado aire libre fruta verdura ruido regateo",
                registerInstruction: "Registro informal pero respetuoso. Tratamiento tú o usted según distancia; regateo amable. Permitidas expresiones coloquiales suaves, prohibidos insultos.",
                icon: Apple,
                actions: [
                    { label: "Preguntar Precio Kilo", value: "Preguntar a cuánto están las naranjas hoy", icon: DollarSign },
                    { label: "Pedir Fruta Madura", value: "Pedir aguacates que estén listos para comer hoy", icon: Hand },
                    { label: "Regatear (Básico)", value: "Intentar bajar el precio un poco de forma amable", icon: TrendingUp },
                    { label: "Probar Producto", value: "Preguntar si se puede probar el queso antes de comprar", icon: Smile },
                    { label: "Origen del Producto", value: "Preguntar si los tomates son de aquí o importados", icon: Globe },
                    { label: "Pedir Cambio", value: "Solo tiene un billete grande y necesita cambio", icon: Euro },
                    { label: "Bolsa Rota", value: "Se le ha roto la bolsa y pide otra", icon: ShoppingBag },
                    { label: "Horario Mercado", value: "Preguntar qué días ponen el mercado", icon: Clock }
                ]
            },
            {
                label: "Cine / Taquilla",
                value: "Cine taquilla palomitas cola entrada",
                registerInstruction: "Registro de ventanilla formal neutro. Tratamiento: usted. Frases cortas y directas. Sin jerga ni bromas excesivas.",
                icon: Film,
                actions: [
                    { label: "Comprar Entradas", value: "Dos entradas para la película de las 7", icon: Ticket },
                    { label: "Elegir Asientos", value: "Prefiere sentarse en el pasillo o atrás", icon: UserPlus },
                    { label: "Combo Palomitas", value: "Pedir palomitas grandes y bebida sin hielo", icon: Popcorn },
                    { label: "Película Subtitulada", value: "Preguntar si la peli es en versión original o doblada", icon: MessageCircle },
                    { label: "Sala Incorrecta", value: "Preguntar dónde está la sala 5", icon: HelpCircle },
                    { label: "Descuento Estudiante", value: "Preguntar si hay descuento con carnet joven", icon: DollarSign }
                ]
            },
            {
                label: "Oficina de Correos",
                value: "Oficina correos paquete ventanilla cola",
                registerInstruction: "Registro formal de trámite. Tratamiento: usted. Vocabulario funcional (envío, plazo, formulario). Prohibido coloquialismos.",
                icon: Stamp,
                actions: [
                    { label: "Enviar Paquete", value: "Quiere enviar una caja a otro país", icon: Rocket },
                    { label: "Comprar Sellos", value: "Necesita sellos para unas postales", icon: Check },
                    { label: "Recoger Paquete", value: "Trae un aviso de llegada para recoger algo", icon: FileText },
                    { label: "Preguntar Plazos", value: "Preguntar cuánto tarda en llegar una carta ordinaria", icon: Clock },
                    { label: "Rellenar Formulario", value: "Pedir ayuda para rellenar el impreso de envío", icon: HelpCircle },
                    { label: "Paquete Pesado", value: "Preguntar cuánto cuesta por kilo", icon: Scale }
                ]
            },
            {
                label: "Estación de Tren/Bus",
                value: "Estación tren andén taquilla transporte público",
                registerInstruction: "Registro funcional y cortés en transporte público. Tratamiento: usted. Instrucciones precisas de horarios y andenes. Sin jerga ni insultos.",
                icon: Train,
                actions: [
                    { label: "Comprar Billete Ida", value: "Comprar un billete sencillo para el próximo tren", icon: Ticket },
                    { label: "Preguntar Andén", value: "No encuentra su tren y pregunta de dónde sale", icon: HelpCircle },
                    { label: "Reportar Objeto Perdido", value: "Ha perdido una mochila y pregunta en información", icon: Search },
                    { label: "Cambiar Horario", value: "Quiere cambiar su billete para una hora más tarde", icon: Clock },
                    { label: "Preguntar Retraso", value: "El tren no llega y pregunta cuánto falta", icon: AlertTriangle },
                    { label: "Máquina Expendedora", value: "No sabe usar la máquina automática y pide ayuda", icon: Hand },
                    { label: "Validar Ticket", value: "Preguntar dónde se pica o valida el billete", icon: Check },
                    { label: "Asiento Reservado", value: "Alguien está sentado en su sitio y se lo indica", icon: UserPlus }
                ]
            },
            {
                label: "Biblioteca",
                value: "Biblioteca silencio libros estudio",
                registerInstruction: "Registro formal suave y tranquilo. Tratamiento: usted. Volumen bajo y cortesía estricta. Prohibidos coloquialismos ruidosos.",
                icon: BookOpen,
                actions: [
                    { label: "Hacerse Socio", value: "Quiere el carnet de la biblioteca", icon: UserPlus },
                    { label: "Devolver Libro", value: "Entregar un libro prestado", icon: BookOpen },
                    { label: "Wifi", value: "Preguntar cómo conectarse a la red", icon: Wifi },
                    { label: "Buscar Libro", value: "No encuentra una novela en la estantería", icon: Search },
                    { label: "Multa Retraso", value: "Preguntar cuánto tiene que pagar por el retraso", icon: DollarSign },
                    { label: "Horario Sala", value: "Preguntar hasta qué hora se puede estudiar", icon: Clock }
                ]
            },
            {
                label: "Hotel (Recepción)",
                value: "Hotel lobby recepción turismo mostrador",
                registerInstruction: "Registro de hotelería formal. Tratamiento: usted. Lenguaje cordial, sin familiaridad ni jerga.",
                icon: Bed,
                actions: [
                    { label: "Hacer Check-in", value: "Llegada al hotel, dar pasaporte y recibir llave", icon: Key },
                    { label: "Problema: Aire Acondicionado", value: "El aire o calefacción de la habitación no funciona", icon: Thermometer },
                    { label: "Pedir Desayuno", value: "Preguntar horario y precio del desayuno", icon: Coffee },
                    { label: "Pedir Taxi", value: "Solicitar que llamen a un taxi para ir al aeropuerto", icon: Car },
                    { label: "Clave del Wifi", value: "Preguntar la contraseña de internet", icon: Wifi },
                    { label: "Dejar Maletas", value: "Pedir guardar el equipaje después del check-out", icon: ShoppingBag },
                    { label: "Pedir Toallas", value: "Faltan toallas en el baño y llama a recepción", icon: Hand },
                    { label: "Despertador", value: "Pedir que le despierten a las 7:00 AM", icon: Clock }
                ]
            },
            {
                label: "En la Calle (Ciudad)",
                value: "Calle ciudad exterior tráfico ruido peatones",
                registerInstruction: "Registro informal cortés entre desconocidos. Tratamiento: usted o tú según cercanía, pero sin confianza excesiva. Evitar lunfardo fuerte.",
                icon: Map,
                actions: [
                    { label: "Preguntar Dirección", value: "Perdido, pregunta cómo llegar a la Plaza Mayor", icon: MapPin },
                    { label: "Preguntar Hora", value: "Se le acabó la batería y pregunta la hora", icon: Clock },
                    { label: "Buscar Metro", value: "Preguntar dónde está la boca de metro más cercana", icon: Train },
                    { label: "Sacar una Foto", value: "Pedir a un extraño que le saque una foto", icon: Camera },
                    { label: "Parada de Taxi", value: "Preguntar dónde se cogen los taxis", icon: Car },
                    { label: "Calle Cortada", value: "Un policía indica que no se puede pasar por ahí", icon: AlertOctagon },
                    { label: "Clima / Lluvia", value: "Comentario casual sobre que empieza a llover", icon: Umbrella }
                ]
            },
            {
                label: "Tienda de Ropa",
                value: "Tienda ropa centro comercial probadores",
                registerInstruction: "Registro comercial formal neutro. Tratamiento: usted. Solicitudes claras sobre talla y precio. Sin jerga ni bromas.",
                icon: ShoppingBag,
                actions: [
                    { label: "Pedir Talla Diferente", value: "La prenda es pequeña, necesita una talla más grande", icon: Search },
                    { label: "Devolución", value: "Quiere devolver algo que compró ayer", icon: Receipt },
                    { label: "Preguntar Precio", value: "El artículo no tiene etiqueta y quiere saber cuánto cuesta", icon: DollarSign },
                    { label: "Buscar Probadores", value: "Preguntar dónde se puede probar la ropa", icon: MapPin },
                    { label: "Pagar (Caja)", value: "Pagar en efectivo y pedir bolsa", icon: Wallet },
                    { label: "Color Diferente", value: "Preguntar si tienen esto mismo en azul", icon: Palette },
                    { label: "Regalo", value: "Pedir ticket regalo o envolver para regalo", icon: Gift }
                ]
            },
            {
                label: "Farmacia",
                value: "Farmacia mostrador salud medicina",
                registerInstruction: "Registro sanitario formal y respetuoso. Tratamiento: usted. Lenguaje claro sobre síntomas y dosis. Prohibido coloquialismos.",
                icon: Pill,
                actions: [
                    { label: "Pedir Analgésico", value: "Le duele la cabeza y pide algo para el dolor", icon: Pill },
                    { label: "Preguntar Dosis", value: "No sabe cuántas pastillas tomar al día", icon: HelpCircle },
                    { label: "Comprar Mascarillas/Curitas", value: "Necesita material básico de primeros auxilios", icon: ShoppingBag },
                    { label: "Consultar Síntoma Leve", value: "Tiene tos y pide jarabe", icon: Stethoscope },
                    { label: "Crema Solar", value: "Pedir protección solar para la playa", icon: Sun },
                    { label: "Horario de Guardia", value: "Preguntar qué farmacia está abierta de noche", icon: Clock }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Comisaría de Policía",
                value: "Comisaría policía oficina denuncias serio",
                registerInstruction: "Registro institucional muy formal. Tratamiento: usted. Relato claro y sobrio, sin ironías ni coloquialismos. Prohibido lunfardo.",
                icon: Siren,
                actions: [
                    { label: "Denunciar Robo Cartera", value: "Explicar que le robaron la cartera en el metro", icon: Wallet },
                    { label: "Pérdida de Pasaporte", value: "Necesita un justificante porque perdió el pasaporte", icon: FileText },
                    { label: "Queja Ruido Vecinos", value: "Poner una denuncia por ruido excesivo", icon: Music },
                    { label: "Testigo de Accidente", value: "Dar testimonio de un choque que vio en la calle", icon: Eye },
                    { label: "Renovar DNI", value: "Preguntar qué papeles necesita para renovar identidad", icon: FileText },
                    { label: "Multa Injusta", value: "Intentar recurrir una multa de tráfico", icon: AlertOctagon }
                ]
            },
            {
                label: "Soporte Técnico",
                value: "Oficina informática teléfono ordenadores cables",
                registerInstruction: "Registro técnico semi-formal. Tratamiento: usted. Descripciones precisas de fallos y pasos. Evitar jerga vulgar.",
                icon: Headphones,
                actions: [
                    { label: "Internet no Funciona", value: "El router tiene luz roja y no hay wifi", icon: Wifi },
                    { label: "Ordenador Lento", value: "Quejarse de que el PC va muy lento", icon: Laptop },
                    { label: "Olvido de Contraseña", value: "Pedir restablecer la contraseña del correo", icon: Lock },
                    { label: "Impresora Atascada", value: "Pedir ayuda porque el papel se atascó", icon: FileText },
                    { label: "Virus Detectado", value: "Mensaje de alerta en pantalla y pánico", icon: ShieldAlert },
                    { label: "Instalar Programa", value: "Necesita permisos para instalar software", icon: Download }
                ]
            },
            {
                label: "Cena con Amigos",
                value: "Restaurante cena amigos ambiente relajado risas",
                registerInstruction: "Registro informal entre amigos. Tratamiento: tú/vos según acento. Permitidos coloquialismos suaves y risas, pero sin insultos fuertes.",
                icon: Utensils,
                actions: [
                    { label: "Dividir la Cuenta (Lío)", value: "Intentan pagar a escote pero las cuentas no salen y discuten", icon: DollarSign },
                    { label: "Contar un Chisme", value: "Uno cuenta un secreto sobre una pareja que no está", icon: MessageCircle },
                    { label: "Anunciar Noticia", value: "Alguien anuncia que se casa o se muda", icon: Sparkles },
                    { label: "Debate sobre Comida", value: "Discusión amistosa sobre si la pizza lleva piña o no", icon: MessageCircle },
                    { label: "Organizar Viaje", value: "Planean irse juntos de vacaciones el próximo mes", icon: Plane },
                    { label: "Recordar Anécdota", value: "Hablar de algo divertido que les pasó hace años", icon: Smile },
                    { label: "Cancelar Plan", value: "Uno dice que mañana no podrá ir al cine al final", icon: X },
                    { label: "Pedir Consejo Amoroso", value: "Uno pide ayuda con su situación sentimental", icon: Heart }
                ]
            },
            {
                label: "Trabajo / Oficina",
                value: "Oficina trabajo reunión formal despacho",
                registerInstruction: "Registro laboral semi-formal. Tratamiento: usted con superiores y tú con pares. Lenguaje profesional, sin lunfardo ni sarcasmo agresivo.",
                icon: Briefcase,
                actions: [
                    { label: "Justificar Retraso", value: "Llega tarde y tiene que inventar una excusa creíble al jefe", icon: Clock },
                    { label: "Pedir Aumento/Días", value: "Negociación tensa para pedir vacaciones o más dinero", icon: DollarSign },
                    { label: "Explicar Error", value: "Ha cometido un fallo en un informe y lo confiesa", icon: AlertTriangle },
                    { label: "Chisme Laboral", value: "Hablar mal de un compañero que no trabaja", icon: MessageCircle },
                    { label: "Delegar Tarea", value: "Pedir a un compañero que haga tu trabajo por una urgencia", icon: Hand },
                    { label: "Problema Informático", value: "El ordenador no va y llama al técnico enfadado", icon: Laptop },
                    { label: "Organizar Reunión", value: "Intentar cuadrar agendas imposibles con un cliente", icon: Clock },
                    { label: "Despedida Compañero", value: "Hablar sobre qué regalar al que se jubila", icon: Gift }
                ]
            },
            {
                label: "Agencia Inmobiliaria",
                value: "Oficina inmobiliaria fotos pisos planos mesa",
                registerInstruction: "Registro formal de negociación. Tratamiento: usted. Vocabulario de alquiler/contrato claro. Prohibido coloquialismos.",
                icon: Building,
                actions: [
                    { label: "Buscar Alquiler", value: "Describir qué tipo de piso busca y presupuesto", icon: Home },
                    { label: "Queja de Vecinos", value: "Llamar a la agencia porque los vecinos hacen ruido", icon: Angry },
                    { label: "Reclamar Fianza", value: "Exigir la devolución del depósito al dejar el piso", icon: DollarSign },
                    { label: "Negociar Contrato", value: "Intentar cambiar una cláusula sobre mascotas", icon: Dog },
                    { label: "Avería en Piso", value: "Reportar que se ha roto la caldera y es urgente", icon: Wrench },
                    { label: "Visitar Piso", value: "Pedir cita para ver un apartamento", icon: Key }
                ]
            },
            {
                label: "Gimnasio",
                value: "Gimnasio pesas máquinas música eco sudor",
                registerInstruction: "Registro informal respetuoso. Tratamiento: tú entre usuarios; usted con recepción si se queja. Evitar groserías.",
                icon: Dumbbell,
                actions: [
                    { label: "Pedir Turno Máquina", value: "Preguntar cuánto le queda al otro en la máquina", icon: Clock },
                    { label: "Explicar Ejercicio", value: "Uno explica al otro cómo hacer bien la sentadilla", icon: Hand },
                    { label: "Queja de Higiene", value: "Alguien no usó toalla y dejó todo sudado", icon: Angry },
                    { label: "Renovar Cuota", value: "Discutir en recepción porque cobraron de más", icon: DollarSign },
                    { label: "Objetivos Año Nuevo", value: "Hablar de perder peso o ganar músculo", icon: TrendingUp },
                    { label: "Clase de Zumba", value: "Comentar lo difícil que fue la clase de hoy", icon: Music }
                ]
            },
            {
                label: "Taller Mecánico",
                value: "Taller mecánico coches herramientas ruido grasa",
                registerInstruction: "Registro de servicio técnico semi-formal. Tratamiento: usted. Explicaciones concretas de averías y presupuestos. Sin jerga vulgar.",
                icon: Wrench,
                actions: [
                    { label: "Describir Ruido Raro", value: "El coche hace 'clac clac' al girar", icon: HelpCircle },
                    { label: "Presupuesto Caro", value: "El mecánico da un precio muy alto y el cliente se queja", icon: DollarSign },
                    { label: "Prisa por Arreglo", value: "Necesita el coche para mañana sin falta", icon: Clock },
                    { label: "ITV (Revisión)", value: "Preguntar si el coche pasará la inspección técnica", icon: CheckCircle },
                    { label: "Batería Muerta", value: "Explicar que el coche no arranca por la mañana", icon: Zap },
                    { label: "Rueda Pinchada", value: "Pedir que arreglen un pinchazo rápido", icon: AlertOctagon }
                ]
            },
            {
                label: "Entrevista de Trabajo",
                value: "Despacho entrevista formal nervios curriculum",
                registerInstruction: "Registro estrictamente formal. Tratamiento: usted. Respuestas profesionales, sin coloquialismos ni muletillas.",
                icon: HeartHandshake,
                actions: [
                    { label: "Hablar de Defectos", value: "Responder a la pregunta 'cuál es tu mayor defecto'", icon: Frown },
                    { label: "Negociar Salario", value: "Preguntar cuánto pagan sin parecer avaricioso", icon: DollarSign },
                    { label: "Experiencia Pasada", value: "Explicar por qué dejó su último trabajo", icon: Briefcase },
                    { label: "Preguntar Horario", value: "Saber si hay flexibilidad o teletrabajo", icon: Clock },
                    { label: "Venderse", value: "Explicar por qué es el mejor candidato", icon: Star },
                    { label: "Preguntas al Final", value: "Hacer preguntas inteligentes al entrevistador", icon: HelpCircle }
                ]
            },
            {
                label: "Veterinario",
                value: "Clínica veterinaria perro gato sala espera",
                registerInstruction: "Registro clínico formal. Tratamiento: usted. Descripciones claras de síntomas y tratamientos. Evitar jerga y bromas.",
                icon: Dog,
                actions: [
                    { label: "Gato no Come", value: "Explicar que la mascota está triste y no come", icon: Frown },
                    { label: "Vacunación", value: "Preguntar qué vacunas tocan este año", icon: Stethoscope },
                    { label: "Urgencia", value: "El perro se ha comido algo tóxico", icon: AlertTriangle },
                    { label: "Corte de Pelo", value: "Pedir cita para peluquería canina", icon: Scissors },
                    { label: "Factura Alta", value: "Sorprenderse por el precio de la operación", icon: DollarSign },
                    { label: "Comportamiento", value: "El perro ladra mucho y pide consejo", icon: MessageCircle }
                ]
            },
            {
                label: "Banco / Finanzas",
                value: "Banco oficina cajero dinero silencio",
                registerInstruction: "Registro financiero formal. Tratamiento: usted. Precisión en cifras y términos bancarios. Prohibidos coloquialismos y chistes.",
                icon: Landmark,
                actions: [
                    { label: "Abrir Cuenta", value: "Preguntar requisitos y comisiones para abrir cuenta", icon: FileText },
                    { label: "Préstamo Rechazado", value: "El director explica por qué no dan el crédito", icon: Ban },
                    { label: "Tarjeta Robada", value: "Llamar para anular una tarjeta por robo", icon: CreditCard },
                    { label: "Error en Cargo", value: "Reclamar un cobro que no reconoce en el extracto", icon: AlertTriangle },
                    { label: "Transferencia Internacional", value: "Preguntar cómo enviar dinero al extranjero", icon: Globe }
                ]
            },
            {
                label: "Consulta Médica",
                value: "Hospital médico consulta privado silencio",
                registerInstruction: "Registro sanitario formal. Tratamiento: usted. Lenguaje claro y respetuoso, sin coloquialismos ni humor.",
                icon: Stethoscope,
                actions: [
                    { label: "Describir Dolor Raro", value: "Explicar un dolor difuso que va y viene", icon: Frown },
                    { label: "Pedir Baja Laboral", value: "Intentar convencer al médico de que no puede trabajar", icon: BriefcaseBusiness },
                    { label: "Miedo a Tratamiento", value: "El paciente tiene miedo a las agujas o la operación", icon: AlertCircle },
                    { label: "Pedir Receta", value: "Necesita medicación crónica que se le acabó", icon: Pill },
                    { label: "Dieta y Hábitos", value: "El médico regaña al paciente por comer mal", icon: Apple },
                    { label: "Pedir Cita Especialista", value: "Quiere que le vea el dermatólogo", icon: UserPlus }
                ]
            },
            {
                label: "Peluquería",
                value: "Peluquería salón secadores tijeras espejo",
                registerInstruction: "Registro cercano pero respetuoso. Tratamiento: tú o usted según edad, tono amable. Evitar groserías.",
                icon: Scissors,
                actions: [
                    { label: "Explicar Corte", value: "Explicar detalladamente cómo quiere el flequillo", icon: Hand },
                    { label: "Resultado Desastroso", value: "No le gusta nada el corte y se queja sutilmente", icon: Frown },
                    { label: "Charla Trivial", value: "Hablar del tiempo y vacaciones con el peluquero", icon: MessageCircle },
                    { label: "Cambio de Look", value: "Quiere teñirse de un color radical", icon: Palette },
                    { label: "Pedir Cita", value: "Llamar para reservar hora el sábado", icon: Phone }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Backstage Concierto",
                value: "Backstage concierto camerino música ruido caos",
                registerInstruction: "Registro coloquial profesional del espectáculo. Tratamiento tú entre equipo, pero sin insultos extremos. Permitida jerga técnica musical.",
                icon: Guitar,
                actions: [
                    { label: "Exigencias de Rider", value: "La estrella se queja de que el agua no es de la marca correcta", icon: Star },
                    { label: "Fallo de Sonido", value: "Técnico discute con el manager por un acople", icon: Mic },
                    { label: "Entrevista Express", value: "Periodista intenta sacar una declaración antes de salir", icon: MessageCircle },
                    { label: "Nervios Pre-Show", value: "El cantante tiene pánico escénico", icon: Frown },
                    { label: "Groupie Colado", value: "Seguridad echa a alguien que se ha colado", icon: Ban },
                    { label: "Cambio de Setlist", value: "Discusión sobre qué canciones tocar", icon: FileText }
                ]
            },
            {
                label: "Redacción Periódico",
                value: "Redacción periodismo ordenadores estrés noticias",
                registerInstruction: "Registro profesional periodístico. Tratamiento tú entre colegas, lenguaje preciso y urgente. Prohibido lunfardo vulgar.",
                icon: Newspaper,
                actions: [
                    { label: "Cambio de Portada", value: "El director cambia la noticia principal a última hora", icon: AlertTriangle },
                    { label: "Fuente Anónima", value: "Discutir si la fuente es fiable o no", icon: ShieldAlert },
                    { label: "Corrección de Errata", value: "Bronca por una falta de ortografía en el titular", icon: X },
                    { label: "Entrevista Fallida", value: "El político ha cancelado la entrevista", icon: Phone },
                    { label: "Fake News", value: "Debatir sobre si publicar un rumor viral", icon: Globe },
                    { label: "Cierre de Edición", value: "Prisa máxima para enviar a imprenta", icon: Clock }
                ]
            },
            {
                label: "Start-up Tecnológica",
                value: "Oficina moderna start-up sofás pizarras inglés",
                registerInstruction: "Registro semi-formal con jerga tecnológica permitida. Tratamiento tú entre equipo. Evitar vulgaridades.",
                icon: Rocket,
                actions: [
                    { label: "Pitch a Inversores", value: "Vender la idea de la empresa usando jerga (growth, kpi)", icon: TrendingUp },
                    { label: "Despido 'Cool'", value: "Despedir a alguien diciendo que es una 'oportunidad'", icon: DoorOpen },
                    { label: "Crisis de Servidores", value: "La app se ha caído y hay pánico técnico", icon: Server },
                    { label: "Brainstorming Absurdo", value: "Ideas ridículas que todos aplauden por compromiso", icon: Lightbulb },
                    { label: "Burnout (Estrés)", value: "Confesar que está quemado de trabajar 15 horas", icon: BatteryLow },
                    { label: "Negociar Equity", value: "Discutir qué porcentaje de la empresa se queda cada uno", icon: PieChart }
                ]
            },
            {
                label: "Juicio / Legal",
                value: "Juzgado tribunal sala legal serio eco",
                registerInstruction: "Registro legal muy formal. Tratamiento: usted. Léxico jurídico y tono respetuoso. Prohibido coloquialismos.",
                icon: Gavel,
                actions: [
                    { label: "Interrogatorio Hostil", value: "Abogado presiona a un testigo para que confiese contradicciones", icon: Zap },
                    { label: "Alegato de Inocencia", value: "Discurso emotivo defendiendo su honorabilidad", icon: Hand },
                    { label: "Objeción Técnica", value: "Discusión sobre un tecnicismo legal aburrido pero crucial", icon: Scale },
                    { label: "Negociar Acuerdo", value: "Intentar llegar a un pacto secreto antes del veredicto", icon: Lock },
                    { label: "Mentira Descubierta", value: "El juez pilla al acusado en una mentira obvia", icon: AlertTriangle },
                    { label: "Lectura de Sentencia", value: "El momento tenso donde se lee el veredicto final", icon: FileText }
                ]
            },
            {
                label: "Galería de Arte",
                value: "Museo galería arte moderno silencioso pasos",
                registerInstruction: "Registro culto y moderadamente formal. Tratamiento: usted o tú según cercanía, pero con vocabulario artístico. Sin jerga vulgar.",
                icon: Palette,
                actions: [
                    { label: "Crítica Pretenciosa", value: "Usar lenguaje muy culto y vacío para criticar un cuadro", icon: Brain },
                    { label: "Fingir Saber", value: "Alguien no entiende nada pero finge ser experto para impresionar", icon: Drama },
                    { label: "Compra de Inversión", value: "Negociar la compra de una obra por millones (blanqueo sutil)", icon: DollarSign },
                    { label: "Debate Ético", value: "Discusión sobre si el arte debe ser político o estético", icon: MessageCircle },
                    { label: "Accidente con Obra", value: "Alguien toca una escultura y casi la rompe", icon: AlertOctagon },
                    { label: "Explicar el Vacío", value: "Justificar por qué un lienzo en blanco es arte", icon: Eye }
                ]
            },
            {
                label: "Terapia Psicológica",
                value: "Consulta diván silencio reloj tic-tac íntimo",
                registerInstruction: "Registro íntimo y respetuoso. Tratamiento: usted si es primera sesión; tono cuidadoso. Evitar sarcasmo o bromas.",
                icon: Brain,
                actions: [
                    { label: "Confesión Traumática", value: "Revelar un evento del pasado que nunca contó a nadie", icon: Lock },
                    { label: "Resistencia al Cambio", value: "El paciente se enfada cuando el psicólogo le dice la verdad", icon: Angry },
                    { label: "Análisis de Sueño", value: "Narración surrealista de un sueño y su interpretación", icon: Ghost },
                    { label: "Ruptura Terapéutica", value: "El paciente decide dejar la terapia porque 'ya está bien'", icon: Hand },
                    { label: "Transferencia", value: "El paciente confiesa estar enamorado del terapeuta", icon: Heart },
                    { label: "Silencio Incómodo", value: "Nadie habla durante un minuto entero (tensión)", icon: Watch }
                ]
            },
            {
                label: "Entrevista Política/Radio",
                value: "Estudio radio entrevista micrófono tensión",
                registerInstruction: "Registro formal de entrevista pública. Tratamiento: usted. Preguntas directas y respuestas medidas. Prohibido coloquialismos.",
                icon: Mic,
                actions: [
                    { label: "Evasión de Respuesta", value: "El político habla mucho sin responder la pregunta difícil", icon: MessageCircle },
                    { label: "Ataque Personal", value: "El entrevistador saca un trapo sucio del pasado", icon: Zap },
                    { label: "Discurso Populista", value: "Promesas grandilocuentes y retórica vacía", icon: Globe },
                    { label: "Corte de Micrófono", value: "Tensión máxima, se interrumpe la entrevista abruptamente", icon: AlertTriangle },
                    { label: "Primicia Exclusiva", value: "Revelar un escándalo en directo", icon: Megaphone },
                    { label: "Debate a Gritos", value: "Dos tertulianos se gritan y no se entiende nada", icon: Frown }
                ]
            },
            {
                label: "Cata de Vinos / Lujo",
                value: "Bodega restaurante lujo copas vino silencio",
                registerInstruction: "Registro formal y sofisticado. Tratamiento: usted. Léxico sensorial y cortesía estricta. Sin jerga vulgar.",
                icon: Wine,
                actions: [
                    { label: "Descripción Sensorial", value: "Describir el sabor del vino con adjetivos imposibles (madera, cuero)", icon: Sparkles },
                    { label: "Esnobismo Puro", value: "Mirar por encima del hombro al que pide cerveza", icon: Eye },
                    { label: "Vino Picado", value: "Devolver una botella de 200€ porque sabe a corcho", icon: ThumbsDown },
                    { label: "Maridaje Incorrecto", value: "El sommelier corrige al cliente por pedir pescado con tinto", icon: Hand },
                    { label: "Brindis Hipócrita", value: "Brindar por el éxito de alguien a quien odias", icon: Smile }
                ]
            },
            {
                label: "Clase Universidad",
                value: "Aula magna universidad eco profesor alumnos",
                registerInstruction: "Registro académico formal. Tratamiento: usted al profesor, tú entre alumnos. Lenguaje preciso, sin coloquialismos.",
                icon: School,
                actions: [
                    { label: "Pregunta Pedante", value: "Alumno pregunta solo para demostrar que sabe más que el profe", icon: GraduationCap },
                    { label: "Revisión de Examen", value: "Discutir una décima de nota en el despacho", icon: FileText },
                    { label: "Plagio Detectado", value: "El profesor acusa al alumno de copiar el trabajo", icon: AlertTriangle },
                    { label: "Debate Filosófico", value: "Discusión abstracta sobre la ética y la moral", icon: Scale },
                    { label: "Explicación Compleja", value: "El profesor explica una teoría que nadie entiende", icon: Brain },
                    { label: "Beca Rechazada", value: "El alumno pide explicaciones por no recibir la beca", icon: DollarSign }
                ]
            },
            {
                label: "Rodaje de Cine",
                value: "Set rodaje cámaras luces silencio acción",
                registerInstruction: "Registro profesional con urgencia. Tratamiento tú entre equipo, instrucciones claras. Evitar insultos fuertes.",
                icon: Camera,
                actions: [
                    { label: "Actor Diva", value: "El protagonista se niega a salir porque el café está frío", icon: Star },
                    { label: "Director Enfadado", value: "Gritar 'Corten' porque nadie hace caso", icon: Megaphone },
                    { label: "Fallo de Raccord", value: "Discutir porque el vaso estaba lleno y ahora vacío", icon: Search },
                    { label: "Escena de Llanto", value: "Intentar llorar pero no sale, presión máxima", icon: Frown },
                    { label: "Doble de Riesgo", value: "Negociar una escena peligrosa", icon: ShieldAlert },
                    { label: "Lluvia Artificial", value: "Coordinar los efectos especiales que fallan", icon: Umbrella }
                ]
            },
            {
                label: "Comunidad de Vecinos",
                value: "Reunión vecinos portal escalera quejas",
                registerInstruction: "Registro semi-formal vecinal. Tratamiento usted en reunión oficial. Lenguaje directo pero respetuoso. Prohibido insultos.",
                icon: Building,
                actions: [
                    { label: "Derrama (Gasto Extra)", value: "Discutir porque hay que pagar el ascensor nuevo", icon: Euro },
                    { label: "Ruidos Nocturnos", value: "Quejarse del vecino del 5º que toca la batería", icon: Music },
                    { label: "Presidente Pesado", value: "Nadie quiere ser presidente de la comunidad", icon: UserPlus },
                    { label: "Obras Ilegales", value: "Acusar a un vecino de cerrar la terraza sin permiso", icon: Hammer },
                    { label: "Llaves del Portal", value: "La llave de abajo no funciona bien", icon: Key },
                    { label: "Morosos", value: "Leer la lista de vecinos que no pagan", icon: FileWarning }
                ]
            },
            {
                label: "Maternidad / Paternidad",
                value: "Parque infantil bebés padres biberón",
                registerInstruction: "Registro informal entre padres, tono empático. Tratamiento tú. Evitar sarcasmo o insultos.",
                icon: Baby,
                actions: [
                    { label: "Consejos No Pedidos", value: "Alguien critica cómo educas a tu hijo", icon: MessageCircle },
                    { label: "Noches sin Dormir", value: "Competir por ver quién duerme menos", icon: Frown },
                    { label: "Elegir Colegio", value: "Debate intenso sobre qué colegio es mejor", icon: School },
                    { label: "Berrinche Público", value: "El niño llora en el súper y todos miran", icon: AlertCircle },
                    { label: "Logros del Bebé", value: "Presumir de que su hijo ya camina o habla", icon: Star },
                    { label: "Comida Orgánica", value: "Debate sobre si dar potitos o comida casera", icon: Apple }
                ]
            },
            {
                label: "Negociación de Paz",
                value: "Sala reuniones ONU banderas serio tensión",
                registerInstruction: "Registro diplomático extremadamente formal. Tratamiento: usted. Tono protocolar y preciso. Prohibido coloquialismos.",
                icon: Globe,
                actions: [
                    { label: "Traducción Errónea", value: "Un error del traductor casi causa una guerra", icon: MessageCircle },
                    { label: "Ultimátum", value: "Una parte da 24 horas para firmar", icon: Clock },
                    { label: "Protocolo Roto", value: "Alguien se sienta donde no debe y ofende al otro", icon: ShieldAlert },
                    { label: "Firma del Tratado", value: "Momento solemne de firmar la paz", icon: FileText },
                    { label: "Espionaje", value: "Descubren un micro en la sala", icon: Mic }
                ]
            }
        ]
    },
    [TextType.PodcastInterview]: {
        [Level.Intro]: [
            {
                label: "Mi Primera Cita Desastrosa",
                value: "Podcast informal donde el invitado cuenta su primera cita romántica que salió mal: el restaurante equivocado, la comida derramada, los silencios incómodos",
                registerInstruction: "Registro informal y cercano. Tratamiento tú. Tono humorístico y ligero. Permitido vocabulario de emociones básicas (nervios, vergüenza, risa). Sin vulgaridades.",
                icon: Heart,
                actions: [
                    { label: "Dónde Fue la Cita", value: "Describir el lugar elegido: un café pequeño, un restaurante ruidoso, un parque", icon: MapPin },
                    { label: "El Momento Incómodo", value: "Contar el momento más vergonzoso: derramó agua, se quedó en silencio, llegó tarde", icon: AlertCircle },
                    { label: "Qué Comieron", value: "Describir la comida y si algo salió mal con el pedido", icon: Utensils },
                    { label: "Cómo Terminó", value: "Contar si hubo segunda cita o nunca más se vieron", icon: ThumbsDown },
                    { label: "Consejo para Otros", value: "Dar un consejo simple para primeras citas", icon: Lightbulb }
                ]
            },
            {
                label: "La Receta de Mi Abuela",
                value: "Podcast emotivo donde el invitado describe el plato especial que hacía su abuela: los olores, el ritual de cocinar juntos, las reuniones familiares",
                registerInstruction: "Registro cercano y emotivo. Tratamiento tú. Vocabulario sensorial simple (olor, sabor, calor). Tono nostálgico pero positivo. Sin jerga.",
                icon: Coffee,
                actions: [
                    { label: "El Plato Especial", value: "Decir el nombre del plato y por qué era especial", icon: Star },
                    { label: "Los Olores de la Cocina", value: "Describir los olores que recuerda: ajo, cebolla, especias", icon: Sparkles },
                    { label: "El Ritual Familiar", value: "Contar quién ayudaba a cocinar y qué hacía cada uno", icon: Heart },
                    { label: "El Momento de Comer", value: "Describir la mesa, quién se sentaba dónde", icon: UserPlus },
                    { label: "Intentar Hacerlo Hoy", value: "Contar si intentó hacer la receta y cómo salió", icon: Smile }
                ]
            },
            {
                label: "Mi Primer Día en el País",
                value: "Podcast donde el invitado cuenta su primer día en un país nuevo: el aeropuerto confuso, las primeras palabras en otro idioma, la comida extraña",
                registerInstruction: "Registro informal narrativo. Tratamiento tú. Vocabulario de viaje básico. Emociones simples (miedo, sorpresa, alegría). Sin lunfardo.",
                icon: Plane,
                actions: [
                    { label: "Llegada al Aeropuerto", value: "Describir el aeropuerto: grande, confuso, con carteles en otro idioma", icon: Plane },
                    { label: "Primera Comida", value: "Contar qué comió el primer día y si le gustó", icon: Utensils },
                    { label: "Primera Conversación", value: "Describir su primera conversación con un local: gestos, palabras básicas", icon: MessageCircle },
                    { label: "Dónde Durmió", value: "Contar dónde pasó la primera noche: hotel, hostal, casa de familia", icon: Bed },
                    { label: "Lo Más Sorprendente", value: "Decir qué le sorprendió más del nuevo país", icon: Sparkles }
                ]
            },
            {
                label: "Mi Mascota Me Salvó el Día",
                value: "Podcast donde el invitado cuenta una anécdota donde su mascota hizo algo inesperado: el perro que ladró al ladrón, el gato que despertó a la familia",
                registerInstruction: "Registro informal y tierno. Tratamiento tú. Vocabulario de animales y emociones. Tono positivo. Sin jerga.",
                icon: Dog,
                actions: [
                    { label: "Presentar a la Mascota", value: "Decir nombre, tipo de animal y cómo llegó a casa", icon: Dog },
                    { label: "El Día Normal", value: "Describir cómo empezó el día: rutina normal", icon: Sun },
                    { label: "Lo Inesperado", value: "Contar qué hizo la mascota que sorprendió a todos", icon: Zap },
                    { label: "La Reacción de la Familia", value: "Describir cómo reaccionaron todos", icon: Heart },
                    { label: "Ahora Es un Héroe", value: "Contar si la mascota recibió algún premio o mimos extra", icon: Star }
                ]
            },
            {
                label: "La Fiesta de Cumpleaños Sorpresa",
                value: "Podcast donde el invitado cuenta una fiesta sorpresa: los preparativos secretos, casi descubren todo, la cara del festejado",
                registerInstruction: "Registro informal y alegre. Tratamiento tú. Vocabulario de celebraciones. Tono entusiasta. Sin vulgaridades.",
                icon: Gift,
                actions: [
                    { label: "El Plan Secreto", value: "Contar cómo organizaron la sorpresa sin que se enterara", icon: Lock },
                    { label: "Casi Lo Descubren", value: "Describir el momento de tensión donde casi se arruina la sorpresa", icon: AlertTriangle },
                    { label: "La Llegada", value: "Contar el momento exacto cuando el festejado entró", icon: DoorOpen },
                    { label: "La Cara de Sorpresa", value: "Describir la reacción: lloró, gritó, se quedó mudo", icon: Sparkles },
                    { label: "El Mejor Momento", value: "Decir cuál fue el mejor momento de la noche", icon: Star }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Mi Peor Viaje de Vacaciones",
                value: "Podcast donde el invitado cuenta un viaje desastroso: el equipaje perdido, el hostal con chinches, la intoxicación alimentaria, los mosquitos",
                registerInstruction: "Registro informal narrativo. Tratamiento tú. Orden cronológico con detalles concretos. Tono humorístico sobre las desgracias. Sin vulgaridades.",
                icon: Plane,
                actions: [
                    { label: "El Destino Elegido", value: "Contar por qué eligieron ese lugar y las expectativas", icon: MapPin },
                    { label: "El Primer Problema", value: "Describir el primer desastre: vuelo cancelado, equipaje perdido", icon: AlertTriangle },
                    { label: "El Alojamiento", value: "Contar cómo era el hotel o hostal: ruido, bichos, sin agua caliente", icon: Bed },
                    { label: "La Comida Peligrosa", value: "Describir si comieron algo que les cayó mal", icon: Frown },
                    { label: "El Momento de Rendirse", value: "Contar cuándo decidieron que el viaje era un desastre", icon: X },
                    { label: "Algo Bueno al Final", value: "Rescatar algo positivo del viaje o la lección aprendida", icon: ThumbsUp }
                ]
            },
            {
                label: "El Jefe que Todos Odiábamos",
                value: "Podcast donde el invitado cuenta historias de un jefe terrible: las reuniones absurdas, los emails a medianoche, el micromanagement extremo",
                registerInstruction: "Registro informal con tono de queja humorística. Tratamiento tú. Permitido sarcasmo suave. Sin insultos directos ni datos reales.",
                icon: Briefcase,
                actions: [
                    { label: "Primera Impresión", value: "Contar cómo conoció al jefe y la primera señal de alarma", icon: Eye },
                    { label: "La Reunión Absurda", value: "Describir una reunión que podía ser un email", icon: Clock },
                    { label: "El Email de Medianoche", value: "Contar sobre mensajes fuera de hora y expectativas imposibles", icon: AlertCircle },
                    { label: "El Compañero Favorito", value: "Hablar del favorito del jefe y cómo afectaba al equipo", icon: Star },
                    { label: "El Día que Renunció", value: "Contar cómo terminó esa situación", icon: DoorOpen },
                    { label: "Lo que Aprendí", value: "Explicar qué aprendió sobre trabajo y líderes", icon: Lightbulb }
                ]
            },
            {
                label: "Mi Gato Destruyó Todo",
                value: "Podcast donde el invitado cuenta las travesuras de su mascota: el sofá arañado, los cables mordidos, el árbol de Navidad derribado",
                registerInstruction: "Registro informal y tierno. Tratamiento tú. Tono de exasperación cariñosa. Detalles específicos de los desastres. Sin jerga.",
                icon: Dog,
                actions: [
                    { label: "Presentar al Culpable", value: "Describir a la mascota: raza, personalidad, cara de inocente", icon: Dog },
                    { label: "El Primer Desastre", value: "Contar la primera cosa que destruyó", icon: AlertTriangle },
                    { label: "La Cosa Más Cara", value: "Describir el objeto más valioso que arruinó", icon: DollarSign },
                    { label: "El Momento Viral", value: "Contar si grabaron un video gracioso para redes", icon: Camera },
                    { label: "Intentos de Solución", value: "Explicar qué intentaron para evitar más desastres", icon: Wrench },
                    { label: "Por Qué Lo Perdonan", value: "Contar por qué sigue siendo el consentido", icon: Heart }
                ]
            },
            {
                label: "Me Perdí en una Ciudad Extranjera",
                value: "Podcast donde el invitado cuenta cómo se perdió sin GPS, sin idioma y sin mapa: las calles iguales, los gestos desesperados, la ayuda inesperada",
                registerInstruction: "Registro informal narrativo. Tratamiento tú. Emociones claras (miedo, alivio, vergüenza). Detalles sensoriales del lugar. Sin lunfardo.",
                icon: Map,
                actions: [
                    { label: "Dónde Estaba", value: "Describir la ciudad y por qué estaba solo/a", icon: MapPin },
                    { label: "Cómo Se Perdió", value: "Contar el momento exacto: el teléfono sin batería, la calle sin nombre", icon: AlertCircle },
                    { label: "Intentos Fallidos", value: "Describir los intentos de pedir ayuda: gestos, dibujos, señalar", icon: Hand },
                    { label: "La Persona que Ayudó", value: "Contar quién le ayudó y cómo se comunicaron", icon: UserPlus },
                    { label: "Cuánto Tiempo Perdido", value: "Decir cuántas horas estuvo perdido", icon: Clock },
                    { label: "Lo que Ahora Siempre Lleva", value: "Contar qué aprendió para no repetirlo", icon: Lightbulb }
                ]
            },
            {
                label: "El Vecino Ruidoso",
                value: "Podcast donde el invitado cuenta la guerra con un vecino: la música a las 3am, las notas pasivo-agresivas, la llamada a la policía, la reconciliación inesperada",
                registerInstruction: "Registro informal con humor. Tratamiento tú. Escalada de conflicto con resolución. Permitido sarcasmo suave. Sin insultos.",
                icon: Home,
                actions: [
                    { label: "Los Primeros Ruidos", value: "Describir cuándo empezó el problema y qué tipo de ruido", icon: Music },
                    { label: "El Primer Reclamo", value: "Contar cómo intentó hablar con el vecino", icon: MessageCircle },
                    { label: "La Escalada", value: "Describir cómo fue empeorando: notas, llamadas, represalias", icon: TrendingUp },
                    { label: "El Punto Crítico", value: "Contar el momento más tenso: policía, gritos, portazo", icon: AlertTriangle },
                    { label: "La Resolución", value: "Explicar cómo se resolvió: acuerdo, mudanza, amistad inesperada", icon: HeartHandshake },
                    { label: "Consejo para Otros", value: "Dar un consejo para conflictos vecinales", icon: ThumbsUp }
                ]
            },
            {
                label: "Mi Primera Entrevista de Trabajo",
                value: "Podcast donde el invitado cuenta su primera entrevista laboral: la corbata mal anudada, la pregunta trampa, el sudor nervioso, la espera eterna",
                registerInstruction: "Registro informal y empático. Tratamiento tú. Detalles de nerviosismo y errores. Tono de aprendizaje. Sin jerga laboral compleja.",
                icon: BriefcaseBusiness,
                actions: [
                    { label: "La Preparación", value: "Contar cómo se preparó: ropa, investigación, ensayo", icon: ListChecks },
                    { label: "El Camino", value: "Describir el viaje: llegó tarde, se perdió, sudando", icon: Bus },
                    { label: "La Sala de Espera", value: "Contar los nervios mientras esperaba", icon: Clock },
                    { label: "La Pregunta Difícil", value: "Describir una pregunta que lo dejó en blanco", icon: HelpCircle },
                    { label: "El Error", value: "Contar el error más vergonzoso de la entrevista", icon: AlertCircle },
                    { label: "El Resultado", value: "Decir si consiguió el trabajo o no y qué aprendió", icon: CheckCircle }
                ]
            },
            {
                label: "Aprendí a Cocinar por YouTube",
                value: "Podcast donde el invitado cuenta sus desastres culinarios aprendiendo con videos: la cocina llena de humo, el plato incomible, la alarma de incendios",
                registerInstruction: "Registro informal y humorístico. Tratamiento tú. Detalles de los desastres. Tono autocrítico pero positivo. Sin jerga.",
                icon: Utensils,
                actions: [
                    { label: "Por Qué Empezó", value: "Contar qué le motivó a aprender a cocinar", icon: Lightbulb },
                    { label: "El Primer Video", value: "Describir qué receta intentó primero", icon: Film },
                    { label: "El Primer Desastre", value: "Contar qué salió terriblemente mal", icon: AlertTriangle },
                    { label: "La Alarma de Incendios", value: "Describir si tuvo que evacuar o si los vecinos llamaron", icon: Siren },
                    { label: "El Plato que Funcionó", value: "Contar su primera receta exitosa", icon: Star },
                    { label: "Ahora Qué Cocina", value: "Decir qué nivel tiene ahora", icon: CheckCircle }
                ]
            },
            {
                label: "La Mudanza Caótica",
                value: "Podcast donde el invitado cuenta una mudanza desastrosa: la camioneta que no llegó, las cajas perdidas, el sofá atascado en la escalera",
                registerInstruction: "Registro informal narrativo. Tratamiento tú. Detalles físicos del caos. Humor sobre el estrés. Sin vulgaridades.",
                icon: Truck,
                actions: [
                    { label: "Por Qué Se Mudaba", value: "Contar el motivo de la mudanza", icon: Home },
                    { label: "El Día D", value: "Describir cómo empezó el día de mudanza", icon: Calendar },
                    { label: "El Primer Problema", value: "Contar el primer obstáculo: camioneta, ayudantes, lluvia", icon: AlertTriangle },
                    { label: "El Objeto Atascado", value: "Describir el mueble que no pasaba por la puerta", icon: X },
                    { label: "Lo que Se Perdió", value: "Contar qué caja nunca apareció", icon: Search },
                    { label: "La Primera Noche", value: "Describir la primera noche en el piso vacío", icon: Moon }
                ]
            },
            {
                label: "El Crush del Trabajo",
                value: "Podcast donde el invitado cuenta una historia de enamoramiento en la oficina: las miradas, los cafés coincidentes, la declaración fallida",
                registerInstruction: "Registro informal y romántico/humorístico. Tratamiento tú. Detalles emocionales. Tono ligero. Sin contenido explícito.",
                icon: Heart,
                actions: [
                    { label: "Cuándo Lo Notó", value: "Contar el momento en que se dio cuenta del crush", icon: Eye },
                    { label: "Las Señales", value: "Describir las señales que interpretaba: miradas, sonrisas", icon: Sparkles },
                    { label: "El Plan", value: "Contar qué estrategia usó para acercarse", icon: Lightbulb },
                    { label: "El Momento de la Verdad", value: "Describir si se declaró o no y cómo", icon: Heart },
                    { label: "El Resultado", value: "Contar cómo terminó: relación, rechazo, amistad", icon: CheckCircle },
                    { label: "Consejo sobre Amor en Trabajo", value: "Dar un consejo basado en su experiencia", icon: ThumbsUp }
                ]
            },
            {
                label: "El Viaje en Bus Eterno",
                value: "Podcast donde el invitado cuenta un viaje en bus interminable: el asiento roto, el bebé llorando, la parada de 5 horas, el compañero de asiento extraño",
                registerInstruction: "Registro informal y quejoso-humorístico. Tratamiento tú. Detalles sensoriales del trayecto. Sin insultos.",
                icon: Bus,
                actions: [
                    { label: "El Destino", value: "Contar adónde iba y cuántas horas debía durar", icon: MapPin },
                    { label: "El Asiento", value: "Describir el estado del asiento: roto, sucio, sin espacio", icon: Frown },
                    { label: "El Compañero", value: "Contar quién se sentó al lado y qué hacía", icon: UserPlus },
                    { label: "La Peor Parada", value: "Describir una parada eterna en la nada", icon: Clock },
                    { label: "Lo que No Llevó", value: "Contar qué olvidó que hubiera salvado el viaje", icon: AlertCircle },
                    { label: "La Llegada", value: "Describir el alivio al llegar finalmente", icon: CheckCircle }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "El Día que Perdí Todo el Dinero",
                value: "Podcast donde un emprendedor cuenta cómo su negocio fracasó: la inversión perdida, la vergüenza familiar, las deudas, y cómo se recuperó",
                registerInstruction: "Registro semi-formal reflexivo. Tratamiento tú. Tono de superación, no victimista. Detalles de emociones y aprendizajes. Sin jerga financiera compleja.",
                icon: TrendingUp,
                actions: [
                    { label: "La Gran Idea", value: "Contar cuál era el negocio y por qué parecía buena idea", icon: Lightbulb },
                    { label: "La Inversión", value: "Describir de dónde sacó el dinero: ahorros, préstamo, familia", icon: DollarSign },
                    { label: "Las Primeras Señales", value: "Contar cuándo empezó a ir mal y qué ignoró", icon: AlertTriangle },
                    { label: "El Día del Colapso", value: "Describir el día en que todo se derrumbó", icon: X },
                    { label: "La Conversación Difícil", value: "Contar cómo le dijo a su familia/pareja", icon: Frown },
                    { label: "La Reconstrucción", value: "Explicar cómo empezó de nuevo y qué aprendió", icon: Star }
                ]
            },
            {
                label: "El Día que Me Despidieron",
                value: "Podcast donde el invitado cuenta el día que perdió su trabajo: la llamada inesperada, vaciar el escritorio, la despedida de compañeros, reinventarse",
                registerInstruction: "Registro semi-formal emotivo. Tratamiento tú. Detalles del momento y emociones. Arco de crisis a oportunidad. Sin victimismo.",
                icon: Briefcase,
                actions: [
                    { label: "El Trabajo Perfecto", value: "Describir por qué amaba ese trabajo", icon: Heart },
                    { label: "Las Señales Ignoradas", value: "Contar si había señales y no las vio", icon: Eye },
                    { label: "La Llamada", value: "Describir el momento exacto: el jefe, la sala, las palabras", icon: Phone },
                    { label: "Vaciar el Escritorio", value: "Contar la humillación de recoger las cosas", icon: ShoppingBag },
                    { label: "La Despedida", value: "Describir cómo fue irse: silencio, abrazos, evitar miradas", icon: DoorOpen },
                    { label: "Qué Vino Después", value: "Contar cómo reinventó su carrera", icon: Rocket }
                ]
            },
            {
                label: "Me Enamoré Durante la Cuarentena",
                value: "Podcast donde el invitado cuenta una historia de amor en pandemia: conocerse online, videollamadas de horas, el primer encuentro físico después de meses",
                registerInstruction: "Registro informal y romántico. Tratamiento tú. Detalles de la conexión virtual y el nerviosismo del encuentro. Sin contenido explícito.",
                icon: Heart,
                actions: [
                    { label: "Cómo Se Conocieron", value: "Contar dónde se conocieron: app, redes, amigos en común", icon: Phone },
                    { label: "La Primera Videollamada", value: "Describir los nervios, qué hablaron, cuánto duró", icon: Laptop },
                    { label: "Las Señales Virtuales", value: "Contar cómo supieron que era algo especial", icon: Heart },
                    { label: "El Plan del Encuentro", value: "Describir cómo decidieron verse y los miedos", icon: Calendar },
                    { label: "El Primer Momento Real", value: "Contar el encuentro físico: nervios, reconocerse, el primer abrazo", icon: Sparkles },
                    { label: "Cómo Están Ahora", value: "Decir si siguen juntos y qué aprendieron", icon: HeartHandshake }
                ]
            },
            {
                label: "Descubrí que Mi Profesor Era un Fraude",
                value: "Podcast donde el invitado cuenta cómo descubrió que un profesor admirado era un fraude: plagio, mentiras en el CV, el escándalo",
                registerInstruction: "Registro semi-formal periodístico. Tratamiento tú. Tono de denuncia pero respetuoso. Hechos y emociones de decepción.",
                icon: GraduationCap,
                actions: [
                    { label: "El Mentor Admirado", value: "Describir por qué admiraba a esta persona", icon: Star },
                    { label: "La Primera Sospecha", value: "Contar qué descubrió que no encajaba", icon: Search },
                    { label: "La Investigación", value: "Describir cómo investigó: Google, preguntar, documentos", icon: FileText },
                    { label: "La Revelación", value: "Contar el momento de confirmar que era mentira", icon: AlertTriangle },
                    { label: "La Decisión de Actuar", value: "Describir si denunció o calló, y por qué", icon: Scale },
                    { label: "Las Consecuencias", value: "Contar qué pasó después: despido, escándalo, silencio", icon: Gavel }
                ]
            },
            {
                label: "Mi Padre Tenía Otra Familia",
                value: "Podcast donde el invitado cuenta cómo descubrió que su padre llevaba doble vida: la llamada extraña, la investigación, el confrontamiento",
                registerInstruction: "Registro semi-formal íntimo. Tratamiento tú. Tono emotivo pero controlado. Respeto por todos los involucrados. Sin morbo.",
                icon: AlertTriangle,
                actions: [
                    { label: "La Familia Original", value: "Describir cómo era la vida familiar antes de saber", icon: Home },
                    { label: "La Primera Pista", value: "Contar qué despertó las sospechas", icon: Eye },
                    { label: "La Investigación Secreta", value: "Describir cómo buscó la verdad", icon: Search },
                    { label: "El Momento de la Verdad", value: "Contar cómo descubrió la otra familia", icon: Zap },
                    { label: "La Confrontación", value: "Describir la conversación con el padre", icon: MessageCircle },
                    { label: "Cómo Está la Familia Ahora", value: "Contar las consecuencias y si hubo reconciliación", icon: Heart }
                ]
            },
            {
                label: "Heredé una Deuda de un Familiar",
                value: "Podcast donde el invitado cuenta cómo tras la muerte de un familiar descubrió deudas ocultas: el notario, los acreedores, el proceso legal",
                registerInstruction: "Registro semi-formal informativo. Tratamiento tú. Tono de advertencia educativa. Detalles del proceso sin tecnicismos legales.",
                icon: FileWarning,
                actions: [
                    { label: "La Muerte del Familiar", value: "Contar el contexto de la pérdida", icon: Heart },
                    { label: "La Visita al Notario", value: "Describir el día de la lectura del testamento", icon: FileText },
                    { label: "El Descubrimiento", value: "Contar el momento de saber de las deudas", icon: AlertTriangle },
                    { label: "Los Acreedores", value: "Describir las llamadas y cartas que empezaron a llegar", icon: Phone },
                    { label: "Las Opciones Legales", value: "Explicar qué opciones tenía: aceptar, renunciar", icon: Scale },
                    { label: "Cómo Lo Resolvió", value: "Contar la decisión final y el aprendizaje", icon: CheckCircle }
                ]
            },
            {
                label: "Me Diagnosticaron una Enfermedad Crónica",
                value: "Podcast donde el invitado cuenta el día del diagnóstico: los síntomas ignorados, las pruebas, la noticia, la adaptación a la nueva vida",
                registerInstruction: "Registro semi-formal empático. Tratamiento tú. Tono de esperanza y adaptación. Sin dramatismo excesivo. Respetar la privacidad médica.",
                icon: Stethoscope,
                actions: [
                    { label: "Los Primeros Síntomas", value: "Contar cuándo empezó a sentirse mal", icon: AlertCircle },
                    { label: "Ignorar las Señales", value: "Describir por qué tardó en ir al médico", icon: Clock },
                    { label: "Las Pruebas", value: "Contar el proceso de diagnóstico", icon: FlaskConical },
                    { label: "El Día del Diagnóstico", value: "Describir el momento de recibir la noticia", icon: FileText },
                    { label: "Contárselo a la Familia", value: "Contar cómo reaccionaron los seres queridos", icon: Heart },
                    { label: "La Nueva Normalidad", value: "Describir cómo adaptó su vida y qué aprendió", icon: Star }
                ]
            },
            {
                label: "Rompí con Mi Mejor Amigo de 15 Años",
                value: "Podcast donde el invitado cuenta el fin de una amistad larga: la traición, el silencio, los intentos de reconciliación, la aceptación",
                registerInstruction: "Registro semi-formal reflexivo. Tratamiento tú. Tono de duelo y madurez. Evitar culpar excesivamente al otro.",
                icon: HeartHandshake,
                actions: [
                    { label: "La Historia de la Amistad", value: "Contar cómo se conocieron y los mejores momentos", icon: Star },
                    { label: "Los Primeros Roces", value: "Describir cuándo empezaron los problemas", icon: AlertCircle },
                    { label: "El Evento Decisivo", value: "Contar qué pasó que rompió todo", icon: Zap },
                    { label: "El Silencio", value: "Describir los días sin hablarse", icon: X },
                    { label: "Los Intentos de Arreglo", value: "Contar si intentaron reconciliarse", icon: MessageCircle },
                    { label: "La Aceptación", value: "Explicar cómo aceptó que la amistad terminó", icon: Brain }
                ]
            },
            {
                label: "Escapé de una Relación Tóxica",
                value: "Podcast donde el invitado cuenta cómo salió de una relación dañina: las señales ignoradas, el punto de quiebre, la reconstrucción personal",
                registerInstruction: "Registro semi-formal de superación. Tratamiento tú. Tono empoderador, no victimista. Sin detalles que identifiquen al otro.",
                icon: Lock,
                actions: [
                    { label: "El Inicio Perfecto", value: "Contar cómo empezó la relación de forma ideal", icon: Heart },
                    { label: "Las Primeras Señales", value: "Describir los primeros comportamientos preocupantes", icon: AlertTriangle },
                    { label: "La Escalada", value: "Contar cómo fue empeorando", icon: TrendingUp },
                    { label: "El Punto de Quiebre", value: "Describir el momento que decidió irse", icon: Zap },
                    { label: "La Salida", value: "Contar cómo logró dejar la relación", icon: DoorOpen },
                    { label: "La Recuperación", value: "Describir el proceso de sanar y qué aprendió", icon: Star }
                ]
            },
            {
                label: "Viví en Otro País Solo a los 18",
                value: "Podcast donde el invitado cuenta su experiencia de irse solo a estudiar/trabajar al extranjero: el miedo, la soledad, el crecimiento",
                registerInstruction: "Registro semi-formal narrativo. Tratamiento tú. Arco de vulnerabilidad a independencia. Detalles sensoriales del lugar.",
                icon: Plane,
                actions: [
                    { label: "La Decisión de Irse", value: "Contar por qué decidió irse y cómo reaccionó la familia", icon: Lightbulb },
                    { label: "La Despedida", value: "Describir el día de irse: aeropuerto, lágrimas", icon: Heart },
                    { label: "Los Primeros Días", value: "Contar la desorientación inicial: idioma, comida, costumbres", icon: AlertCircle },
                    { label: "El Momento Más Solitario", value: "Describir el momento de mayor soledad", icon: Frown },
                    { label: "El Punto de Inflexión", value: "Contar cuándo empezó a sentirse bien", icon: Star },
                    { label: "Lo que Aprendió", value: "Explicar cómo le cambió la experiencia", icon: Brain }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Escapé de una Secta Religiosa",
                value: "Podcast donde el invitado cuenta cómo vivió dentro de una secta: el adoctrinamiento gradual, las señales de alarma, la planificación de la fuga, la vida después",
                registerInstruction: "Registro formal de testimonio. Tratamiento tú. Tono respetuoso y serio. Evitar sensacionalismo. Detalles del proceso psicológico.",
                icon: Lock,
                actions: [
                    { label: "La Llegada a la Secta", value: "Contar cómo llegó y qué le atrajo inicialmente", icon: DoorOpen },
                    { label: "El Adoctrinamiento", value: "Describir cómo fue cambiando su forma de pensar", icon: Brain },
                    { label: "Las Señales Ignoradas", value: "Contar qué empezó a notar que estaba mal", icon: Eye },
                    { label: "El Punto de Quiebre", value: "Describir el momento que decidió irse", icon: Zap },
                    { label: "La Planificación de la Fuga", value: "Contar cómo planeó salir en secreto", icon: Map },
                    { label: "La Vida Después", value: "Describir la reconstrucción de su identidad", icon: Star }
                ]
            },
            {
                label: "Fui Testigo de un Crimen Grave",
                value: "Podcast donde el invitado cuenta cómo presenció un delito: el shock, la decisión de testificar, las amenazas, el juicio",
                registerInstruction: "Registro formal y sobrio. Tratamiento tú. Tono de reflexión ciudadana. Sin detalles que comprometan identidades. Respeto por víctimas.",
                icon: ShieldAlert,
                actions: [
                    { label: "El Día Normal", value: "Describir cómo era el día antes de presenciarlo", icon: Sun },
                    { label: "El Momento del Crimen", value: "Contar qué vio y su reacción inmediata", icon: AlertTriangle },
                    { label: "La Decisión de Hablar", value: "Describir el dilema de testificar o callar", icon: Scale },
                    { label: "Las Consecuencias Personales", value: "Contar si hubo amenazas o miedo", icon: Lock },
                    { label: "El Proceso Judicial", value: "Describir la experiencia de testificar en juicio", icon: Gavel },
                    { label: "La Reflexión Ética", value: "Explicar qué aprendió sobre justicia y ciudadanía", icon: Brain }
                ]
            },
            {
                label: "Mi Hijo Tiene una Adicción",
                value: "Podcast donde un padre/madre cuenta cómo descubrió la adicción de su hijo: las señales, la confrontación, el tratamiento, la esperanza",
                registerInstruction: "Registro formal y emotivo. Tratamiento tú. Tono de testimonio esperanzador. Sin estigmatizar. Enfoque en la familia y recuperación.",
                icon: Heart,
                actions: [
                    { label: "Las Primeras Señales", value: "Contar cuándo empezó a sospechar algo", icon: Eye },
                    { label: "La Confrontación", value: "Describir el momento de hablar con el hijo", icon: MessageCircle },
                    { label: "La Negación", value: "Contar la fase de negación del hijo y/o familia", icon: X },
                    { label: "La Búsqueda de Ayuda", value: "Describir cómo encontraron tratamiento", icon: Search },
                    { label: "El Proceso de Recuperación", value: "Contar los altibajos del tratamiento", icon: TrendingUp },
                    { label: "Dónde Están Ahora", value: "Describir la situación actual y la esperanza", icon: Star }
                ]
            },
            {
                label: "Sobreviví un Desastre Natural",
                value: "Podcast donde el invitado cuenta su experiencia en un terremoto, inundación o huracán: el momento del impacto, la supervivencia, la pérdida, la reconstrucción",
                registerInstruction: "Registro formal narrativo. Tratamiento tú. Detalles sensoriales del evento. Tono de supervivencia y comunidad. Sin morbo.",
                icon: AlertTriangle,
                actions: [
                    { label: "Antes del Desastre", value: "Describir el día normal antes del evento", icon: Sun },
                    { label: "El Momento del Impacto", value: "Contar qué sintió y vio en el momento del desastre", icon: Zap },
                    { label: "La Supervivencia", value: "Describir cómo sobrevivió y a quién ayudó", icon: ShieldAlert },
                    { label: "Las Pérdidas", value: "Contar qué perdió: casa, pertenencias, seres queridos", icon: Frown },
                    { label: "La Ayuda Recibida", value: "Describir quién ayudó y cómo llegó la asistencia", icon: HeartHandshake },
                    { label: "La Reconstrucción", value: "Contar cómo rehizo su vida después", icon: Star }
                ]
            },
            {
                label: "Denuncié a Mi Propia Empresa",
                value: "Podcast donde el invitado cuenta cómo destapó un fraude interno: el descubrimiento, el dilema moral, la denuncia, las represalias, las consecuencias",
                registerInstruction: "Registro formal y analítico. Tratamiento tú. Tono de ética profesional. Sin nombres reales. Enfoque en el proceso de decisión.",
                icon: Search,
                actions: [
                    { label: "El Trabajo Normal", value: "Describir su rol en la empresa antes del descubrimiento", icon: Briefcase },
                    { label: "El Descubrimiento", value: "Contar qué encontró que estaba mal", icon: Eye },
                    { label: "El Dilema Interno", value: "Describir la lucha entre lealtad y ética", icon: Scale },
                    { label: "La Decisión de Denunciar", value: "Contar cómo y a quién denunció", icon: Megaphone },
                    { label: "Las Represalias", value: "Describir las consecuencias: despido, aislamiento, presiones", icon: AlertCircle },
                    { label: "El Resultado Final", value: "Contar qué pasó con la empresa y con su carrera", icon: Gavel }
                ]
            },
            {
                label: "Cuidé a Mi Padre con Alzheimer",
                value: "Podcast donde el invitado cuenta la experiencia de cuidar a un padre con demencia: el diagnóstico, los cambios, las despedidas en vida, la muerte",
                registerInstruction: "Registro formal y empático. Tratamiento tú. Tono de amor y duelo. Sin dramatismo excesivo. Enfoque en la dignidad del enfermo.",
                icon: Heart,
                actions: [
                    { label: "Los Primeros Olvidos", value: "Contar cuándo empezaron a notar los cambios", icon: Brain },
                    { label: "El Diagnóstico", value: "Describir el día que supieron qué era", icon: FileText },
                    { label: "La Vida Como Cuidador", value: "Contar la rutina diaria de cuidar", icon: Clock },
                    { label: "Los Momentos de Conexión", value: "Describir un momento de lucidez o ternura", icon: Sparkles },
                    { label: "Las Despedidas en Vida", value: "Contar cuando dejó de reconocerlo/a", icon: Frown },
                    { label: "Después de la Muerte", value: "Describir el duelo y lo aprendido sobre la vida", icon: Star }
                ]
            },
            {
                label: "Fui Víctima de una Estafa Millonaria",
                value: "Podcast donde el invitado cuenta cómo cayó en un fraude financiero: la promesa, la inversión, el descubrimiento, la ruina, la reconstrucción",
                registerInstruction: "Registro formal de advertencia. Tratamiento tú. Tono educativo sin victimismo. Detallar las señales de alarma. Sin datos que identifiquen estafadores.",
                icon: DollarSign,
                actions: [
                    { label: "La Oportunidad Perfecta", value: "Contar cómo le presentaron la inversión", icon: Lightbulb },
                    { label: "Por Qué Confió", value: "Describir qué le convenció de invertir", icon: HeartHandshake },
                    { label: "Las Primeras Dudas", value: "Contar cuándo empezó a sospechar", icon: Eye },
                    { label: "El Descubrimiento del Fraude", value: "Describir el momento de saber que era estafa", icon: AlertTriangle },
                    { label: "Las Pérdidas", value: "Contar cuánto perdió y cómo afectó su vida", icon: X },
                    { label: "La Reconstrucción", value: "Describir cómo se recuperó financiera y emocionalmente", icon: Star }
                ]
            },
            {
                label: "Adopté Siendo Soltera/o a los 40",
                value: "Podcast donde el invitado cuenta el proceso de adopción monoparental: la decisión, el papeleo, la espera, el encuentro, la nueva familia",
                registerInstruction: "Registro semi-formal y alegre. Tratamiento tú. Tono de esperanza y realismo. Sin idealizar la maternidad/paternidad. Respetar orígenes del niño/a.",
                icon: Heart,
                actions: [
                    { label: "La Decisión de Adoptar", value: "Contar por qué decidió ser padre/madre soltero/a", icon: Lightbulb },
                    { label: "El Proceso Burocrático", value: "Describir el papeleo, los cursos, las entrevistas", icon: FileText },
                    { label: "La Espera Eterna", value: "Contar los meses o años de espera", icon: Clock },
                    { label: "La Llamada", value: "Describir el día que le dijeron que había un niño/a", icon: Phone },
                    { label: "El Primer Encuentro", value: "Contar el momento de conocer a su hijo/a", icon: Sparkles },
                    { label: "La Nueva Familia", value: "Describir la vida ahora y lo aprendido", icon: Home }
                ]
            },
            {
                label: "Escribí un Libro y Lo Rechazaron 50 Veces",
                value: "Podcast donde el invitado cuenta el proceso de publicar su libro: la escritura, los rechazos, la desesperanza, el sí final, el éxito inesperado",
                registerInstruction: "Registro semi-formal inspirador. Tratamiento tú. Tono de perseverancia. Detalles del mundo editorial. Sin arrogancia.",
                icon: BookOpen,
                actions: [
                    { label: "La Idea del Libro", value: "Contar de dónde salió la idea y cuánto tardó en escribir", icon: Lightbulb },
                    { label: "Los Primeros Rechazos", value: "Describir cómo fueron los primeros 'no' y cómo los sintió", icon: ThumbsDown },
                    { label: "El Punto de Rendirse", value: "Contar el momento de mayor desesperanza", icon: Frown },
                    { label: "Lo Que Lo Mantuvo Adelante", value: "Describir qué o quién le dio fuerzas", icon: Heart },
                    { label: "El Sí", value: "Contar el día que alguien dijo que sí", icon: Star },
                    { label: "Después del Éxito", value: "Describir qué pasó cuando el libro salió y si tuvo éxito", icon: Rocket }
                ]
            },
            {
                label: "Cambié de Identidad de Género",
                value: "Podcast donde el invitado cuenta su transición: el descubrimiento interior, contarlo a la familia, el proceso médico/social, la nueva vida",
                registerInstruction: "Registro formal y respetuoso. Tratamiento tú. Tono de autenticidad y empoderamiento. Sin morbo ni detalles médicos innecesarios. Usar lenguaje inclusivo.",
                icon: Star,
                actions: [
                    { label: "El Descubrimiento Interior", value: "Contar cuándo supo que algo no encajaba", icon: Brain },
                    { label: "Contárselo a la Familia", value: "Describir la conversación con los seres queridos", icon: Home },
                    { label: "Las Reacciones", value: "Contar cómo reaccionó cada persona importante", icon: Heart },
                    { label: "El Proceso de Transición", value: "Describir los pasos que dio: terapia, cambios, trámites", icon: ArrowRight },
                    { label: "Los Desafíos Sociales", value: "Contar dificultades en trabajo, amigos, espacios públicos", icon: AlertTriangle },
                    { label: "La Vida Auténtica", value: "Describir cómo es vivir siendo quien realmente es", icon: Sparkles }
                ]
            }
        ]
    },
    [TextType.RadioNews]: {
        [Level.Intro]: [
            {
                label: "Boletín del Tiempo",
                value: "Radio local con reporte costero: viento, mareas y barrios afectados",
                registerInstruction: "Registro: formal noticiero e impersonal, en tercera persona. Sin primera persona. Lunfardo: no. Dicción clara y ritmo informativo.",
                icon: Sun,
                actions: [
                    { label: "Temperatura", value: "Informar temperatura actual por barrios", icon: Thermometer },
                    { label: "Pronóstico Mañana", value: "Indicar el clima de mañana con rangos", icon: Sun },
                    { label: "Aviso de Lluvia", value: "Avisar lluvia y ráfagas previstas", icon: Umbrella },
                    { label: "Consejo Ropa", value: "Recomendar abrigo, piloto o paraguas", icon: Shirt },
                    { label: "Hora del Reporte", value: "Anunciar la hora exacta del boletín", icon: Clock }
                ]
            },
            {
                label: "Tráfico Local",
                value: "Boletín de tráfico en hora pico con túnel, circunvalación y obras",
                registerInstruction: "Registro: formal informativo y objetivo. Lunfardo: no. Sin opiniones; datos precisos de vías y tiempos.",
                icon: Car,
                actions: [
                    { label: "Atasco", value: "Reportar un atasco en un acceso principal", icon: AlertTriangle },
                    { label: "Ruta Alternativa", value: "Dar una alternativa por avenidas secundarias", icon: Map },
                    { label: "Calle Cerrada", value: "Anunciar cierre temporal por obras", icon: AlertOctagon },
                    { label: "Tiempo Estimado", value: "Informar minutos estimados de demora", icon: Clock },
                    { label: "Consejo Transporte", value: "Sugerir usar bus o metro", icon: Bus }
                ]
            },
            {
                label: "Noticias de Escuela",
                value: "Boletín institucional de un instituto público con comunicados de dirección",
                registerInstruction: "Registro: formal institucional y directo. Lunfardo: no. Tono claro, sin bromas ni familiaridad.",
                icon: School,
                actions: [
                    { label: "Actividad", value: "Anunciar una actividad escolar", icon: Flag },
                    { label: "Examen", value: "Recordar fecha de examen", icon: FileText },
                    { label: "Evento Deportivo", value: "Anunciar partido del colegio", icon: Dumbbell },
                    { label: "Cambio Horario", value: "Informar cambio de horario", icon: Clock },
                    { label: "Mensaje Dirección", value: "Leer un mensaje oficial de dirección", icon: MessageCircle }
                ]
            },
            {
                label: "Servicios de la Ciudad",
                value: "Radio municipal con avisos de recolección y cortes programados por barrios",
                registerInstruction: "Registro: formal municipal e impersonal. Lunfardo: no. Mensajes breves y precisos.",
                icon: Building,
                actions: [
                    { label: "Basura", value: "Avisar cambio de horario de basura", icon: Trash2 },
                    { label: "Corte de Agua/Luz", value: "Anunciar corte temporal en zonas específicas", icon: AlertCircle },
                    { label: "Horario Biblioteca", value: "Informar horario especial de la biblioteca", icon: BookOpen },
                    { label: "Campaña Limpieza", value: "Anunciar campaña de limpieza barrial", icon: Sparkles },
                    { label: "Teléfono de Información", value: "Dar un número de contacto", icon: Phone }
                ]
            },
            {
                label: "Agenda Cultural",
                value: "Agenda cultural de fin de semana con teatro independiente y feria del libro",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Datos de fechas, horarios y sedes sin adornos.",
                icon: Ticket,
                actions: [
                    { label: "Concierto", value: "Anunciar un concierto local", icon: Music },
                    { label: "Museo Gratis", value: "Informar día gratuito en museo", icon: Palette },
                    { label: "Feria", value: "Invitar a una feria en la plaza", icon: MapPin },
                    { label: "Hora y Lugar", value: "Dar hora y lugar del evento", icon: Clock },
                    { label: "Invitación", value: "Animar a asistir", icon: ThumbsUp }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Noticias Locales",
                value: "Noticia de barrio sobre cierre de puente peatonal y obras en la ribera",
                registerInstruction: "Registro: formal noticioso y objetivo. Lunfardo: no. Sin opinión personal.",
                icon: Newspaper,
                actions: [
                    { label: "Incidente Menor", value: "Contar un incidente menor en el barrio", icon: AlertTriangle },
                    { label: "Declaración Breve", value: "Leer una declaración corta", icon: MessageCircle },
                    { label: "Datos Básicos", value: "Dar datos básicos (lugar, hora)", icon: Clock },
                    { label: "Estado Actual", value: "Decir cómo está la situación ahora", icon: CheckCircle },
                    { label: "Recomendación", value: "Dar una recomendación al público", icon: ThumbsUp }
                ]
            },
            {
                label: "Deportes de Barrio",
                value: "Boletín deportivo de liga barrial y torneo escolar de fin de semana",
                registerInstruction: "Registro: formal deportivo con entusiasmo moderado. Lunfardo: no. Evitar gritos o jergas.",
                icon: Dumbbell,
                actions: [
                    { label: "Resultado", value: "Dar el resultado de un partido", icon: Star },
                    { label: "Jugador Destacado", value: "Mencionar a un jugador destacado", icon: ThumbsUp },
                    { label: "Próximo Encuentro", value: "Anunciar el próximo partido", icon: Calendar },
                    { label: "Comentario Entrenador", value: "Leer un comentario del entrenador", icon: MessageCircle },
                    { label: "Invitar a Hinchada", value: "Invitar a apoyar al equipo", icon: Flag }
                ]
            },
            {
                label: "Economía Doméstica",
                value: "Boletín sobre precios de la canasta básica en mercados barriales",
                registerInstruction: "Registro: formal económico. Lunfardo: no. Datos y consejos claros, sin opinología.",
                icon: DollarSign,
                actions: [
                    { label: "Subida de Precio", value: "Informar subida de un producto", icon: TrendingUp },
                    { label: "Consejo de Ahorro", value: "Dar un consejo simple para ahorrar", icon: PiggyBank },
                    { label: "Comparar Precios", value: "Comparar precios entre mercados", icon: Scale },
                    { label: "Mercado del Día", value: "Describir productos del día", icon: Apple },
                    { label: "Entrevista a Comerciante", value: "Leer una frase de un comerciante", icon: MessageCircle }
                ]
            },
            {
                label: "Salud Pública",
                value: "Avisos de salud con campaña antigripal y horarios de centros",
                registerInstruction: "Registro: formal sanitario y calmado. Lunfardo: no. Mensajes objetivos.",
                icon: Stethoscope,
                actions: [
                    { label: "Campaña Vacunación", value: "Anunciar campaña de vacunación", icon: ShieldAlert },
                    { label: "Prevención", value: "Dar recomendaciones de prevención", icon: Hand },
                    { label: "Síntomas Básicos", value: "Mencionar síntomas básicos", icon: AlertCircle },
                    { label: "Lugar de Atención", value: "Indicar centros de atención", icon: MapPin },
                    { label: "Llamado a Calma", value: "Transmitir un mensaje de calma", icon: Heart }
                ]
            },
            {
                label: "Transporte Regional",
                value: "Noticias sobre buses interurbanos y tren regional por obras",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Horarios y rutas precisas.",
                icon: Train,
                actions: [
                    { label: "Nuevo Horario", value: "Informar nuevo horario de buses", icon: Clock },
                    { label: "Huelga Parcial", value: "Avisar una huelga parcial", icon: AlertTriangle },
                    { label: "Venta de Billetes", value: "Explicar dónde comprar billetes", icon: Ticket },
                    { label: "Retrasos", value: "Reportar retrasos en rutas", icon: Watch },
                    { label: "Alternativas", value: "Sugerir rutas alternativas", icon: Map }
                ]
            },
            {
                label: "Clima Extremo",
                value: "Alerta por ola de calor o tormenta con protocolo municipal",
                registerInstruction: "Registro: formal de alerta y serio. Lunfardo: no. Mensajes directos y claros.",
                icon: AlertOctagon,
                actions: [
                    { label: "Alerta", value: "Declarar alerta por calor o frío", icon: AlertOctagon },
                    { label: "Medidas Básicas", value: "Explicar medidas de protección", icon: ShieldAlert },
                    { label: "Impacto Escolar", value: "Informar cambios en escuelas", icon: School },
                    { label: "Hidratación", value: "Recomendar beber agua", icon: Droplet },
                    { label: "Actualización", value: "Anunciar actualización en horas", icon: Clock }
                ]
            },
            {
                label: "Ferias y Mercados",
                value: "Boletín sobre ferias barriales con controles sanitarios",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Datos precisos y útiles.",
                icon: ShoppingBag,
                actions: [
                    { label: "Ubicación", value: "Informar ubicación de la feria", icon: MapPin },
                    { label: "Horario", value: "Dar horario de apertura", icon: Clock },
                    { label: "Precios Referencia", value: "Informar precios orientativos", icon: DollarSign },
                    { label: "Normas Sanitarias", value: "Recordar normas sanitarias", icon: ShieldAlert },
                    { label: "Convocatoria", value: "Invitar a asistir", icon: ThumbsUp }
                ]
            },
            {
                label: "Seguridad Vial",
                value: "Boletín de seguridad vial con controles y accidentes menores",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Mensajes claros y preventivos.",
                icon: ShieldAlert,
                actions: [
                    { label: "Control", value: "Informar un control de tránsito", icon: AlertTriangle },
                    { label: "Accidente Menor", value: "Reportar un accidente sin heridos", icon: Car },
                    { label: "Desvío", value: "Anunciar desvío por operativo", icon: Map },
                    { label: "Consejo Peatones", value: "Dar consejo a peatones", icon: Hand },
                    { label: "Emergencias", value: "Recordar número de emergencias", icon: Phone }
                ]
            },
            {
                label: "Consumo y Energía",
                value: "Boletín sobre tarifas y consumo eléctrico residencial",
                registerInstruction: "Registro: formal económico. Lunfardo: no. Información precisa y útil.",
                icon: Lightbulb,
                actions: [
                    { label: "Tarifa", value: "Informar ajuste tarifario", icon: FileText },
                    { label: "Ahorro", value: "Dar un consejo de ahorro", icon: PiggyBank },
                    { label: "Pico de Demanda", value: "Avisar horarios de mayor demanda", icon: Clock },
                    { label: "Corte Programado", value: "Anunciar corte programado", icon: AlertCircle },
                    { label: "Recomendación", value: "Recomendar uso responsable", icon: ThumbsUp }
                ]
            },
            {
                label: "Turismo Local",
                value: "Boletín turístico con datos de ocupación y actividades",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Tono objetivo.",
                icon: MapPin,
                actions: [
                    { label: "Ocupación", value: "Informar nivel de ocupación hotelera", icon: Bed },
                    { label: "Actividad", value: "Anunciar una actividad turística", icon: Ticket },
                    { label: "Dato de Afluencia", value: "Dar un dato de visitantes", icon: PieChart },
                    { label: "Recomendación", value: "Sugerir un paseo", icon: ThumbsUp },
                    { label: "Consejo Tránsito", value: "Advertir sobre accesos", icon: Car }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Política Municipal",
                value: "Sesión del concejo sobre presupuesto participativo del distrito",
                registerInstruction: "Registro: formal político e impersonal. Lunfardo: no. Resumen objetivo sin opiniones.",
                icon: Building,
                actions: [
                    { label: "Debate", value: "Resumir un debate municipal", icon: MessageCircle },
                    { label: "Cita de Concejal", value: "Leer una cita de un concejal", icon: FileText },
                    { label: "Proyecto Aprobado", value: "Anunciar un proyecto aprobado", icon: CheckCircle },
                    { label: "Posturas Opuestas", value: "Contrastar posturas políticas", icon: Scale },
                    { label: "Próximos Pasos", value: "Explicar próximos pasos", icon: ArrowRight }
                ]
            },
            {
                label: "Economía Nacional",
                value: "Boletín con inflación mensual y datos de empleo juvenil",
                registerInstruction: "Registro: formal económico. Lunfardo: no. Datos verificables y tono objetivo.",
                icon: PieChart,
                actions: [
                    { label: "Dato de Inflación", value: "Dar un dato de inflación", icon: TrendingUp },
                    { label: "Entrevista Experta", value: "Citar a un experto", icon: MessageCircle },
                    { label: "Impacto en Salarios", value: "Explicar impacto en salarios", icon: DollarSign },
                    { label: "Medida Gobierno", value: "Anunciar una medida oficial", icon: FileText },
                    { label: "Análisis Breve", value: "Hacer un análisis corto", icon: Brain }
                ]
            },
            {
                label: "Tecnología y Sociedad",
                value: "Noticias sobre nueva ley de datos y filtración en app popular",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Explicaciones claras de riesgos.",
                icon: Laptop,
                actions: [
                    { label: "Nuevo Servicio", value: "Presentar un nuevo servicio digital", icon: Sparkles },
                    { label: "Riesgos Privacidad", value: "Explicar riesgos de privacidad", icon: Lock },
                    { label: "Declaración Empresa", value: "Leer comunicado de empresa", icon: FileText },
                    { label: "Reacción Usuarios", value: "Contar reacción de usuarios", icon: MessageCircle },
                    { label: "Consejo de Uso", value: "Dar consejo de uso seguro", icon: ShieldAlert }
                ]
            },
            {
                label: "Ciencia y Salud",
                value: "Boletín sobre estudio de salud pública y uso de antibióticos",
                registerInstruction: "Registro: formal divulgativo. Lunfardo: no. Tono neutral y preciso.",
                icon: FlaskConical,
                actions: [
                    { label: "Estudio Reciente", value: "Presentar un estudio reciente", icon: BookOpen },
                    { label: "Explicación", value: "Explicar el estudio en lenguaje claro", icon: Brain },
                    { label: "Aplicación", value: "Mencionar una aplicación práctica", icon: Wrench },
                    { label: "Advertencia", value: "Dar una advertencia", icon: AlertTriangle },
                    { label: "Fuente", value: "Citar la fuente del estudio", icon: FileText }
                ]
            },
            {
                label: "Medio Ambiente",
                value: "Noticias sobre incendio en parque natural con evacuación de campings",
                registerInstruction: "Registro: formal y urgente. Lunfardo: no. Información precisa y objetiva.",
                icon: TreePine,
                actions: [
                    { label: "Incendio", value: "Reportar un incendio forestal", icon: AlertTriangle },
                    { label: "Evacuación", value: "Informar estado de evacuación", icon: MapPin },
                    { label: "Bomberos", value: "Contar trabajo de bomberos", icon: FireExtinguisher },
                    { label: "Área Afectada", value: "Dar datos de área afectada", icon: Map },
                    { label: "Consejo Seguridad", value: "Dar consejos de seguridad", icon: ShieldAlert }
                ]
            },
            {
                label: "Tribunales",
                value: "Noticias de juicio por fraude en licitaciones municipales",
                registerInstruction: "Registro: formal judicial. Lunfardo: no. Lenguaje preciso, sin opiniones.",
                icon: Gavel,
                actions: [
                    { label: "Resumen del Caso", value: "Resumir el caso judicial", icon: FileText },
                    { label: "Declaración Abogado", value: "Leer declaración del abogado", icon: MessageCircle },
                    { label: "Calendario", value: "Anunciar fechas del juicio", icon: Calendar },
                    { label: "Reacción Pública", value: "Explicar reacción del público", icon: Frown },
                    { label: "Siguiente Sesión", value: "Indicar próxima sesión", icon: Clock }
                ]
            },
            {
                label: "Economía Internacional",
                value: "Boletín sobre exportación de litio y nuevos aranceles",
                registerInstruction: "Registro: formal económico. Lunfardo: no. Datos y análisis breves.",
                icon: Globe,
                actions: [
                    { label: "Tipo de Cambio", value: "Dar el tipo de cambio actual", icon: Euro },
                    { label: "Comercio Exterior", value: "Explicar movimiento comercial", icon: Ship },
                    { label: "Impacto Importaciones", value: "Explicar impacto en importaciones", icon: TrendingUp },
                    { label: "Cita de Analista", value: "Citar un analista", icon: MessageCircle },
                    { label: "Resumen Final", value: "Cerrar con resumen claro", icon: CheckCircle }
                ]
            },
            {
                label: "Infraestructura Urbana",
                value: "Noticias sobre obra pública con plazos y licitaciones",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Datos verificables.",
                icon: Wrench,
                actions: [
                    { label: "Obra", value: "Informar avance de obra", icon: Hammer },
                    { label: "Plazos", value: "Dar plazos estimados", icon: Calendar },
                    { label: "Impacto", value: "Explicar impacto en servicios", icon: AlertTriangle },
                    { label: "Licitación", value: "Mencionar proceso de licitación", icon: FileText },
                    { label: "Desvíos", value: "Informar desvíos temporales", icon: Map }
                ]
            },
            {
                label: "Educación Superior",
                value: "Boletín universitario con cupos y becas",
                registerInstruction: "Registro: formal educativo. Lunfardo: no. Información clara y ordenada.",
                icon: GraduationCap,
                actions: [
                    { label: "Inscripción", value: "Informar fechas de inscripción", icon: Calendar },
                    { label: "Cupos", value: "Dar datos de cupos disponibles", icon: PieChart },
                    { label: "Becas", value: "Anunciar becas abiertas", icon: FileText },
                    { label: "Declaración Rector", value: "Leer declaración del rector", icon: MessageCircle },
                    { label: "Calendario", value: "Recordar calendario académico", icon: Clock }
                ]
            },
            {
                label: "Seguridad Ciudadana",
                value: "Noticias sobre operativos y estadísticas de seguridad",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Tono sobrio.",
                icon: Siren,
                actions: [
                    { label: "Operativo", value: "Reportar un operativo policial", icon: ShieldAlert },
                    { label: "Estadísticas", value: "Dar un dato estadístico", icon: PieChart },
                    { label: "Declaración Oficial", value: "Leer una declaración oficial", icon: MessageCircle },
                    { label: "Investigación", value: "Informar estado de una investigación", icon: Search },
                    { label: "Recomendación", value: "Dar una recomendación preventiva", icon: Hand }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Última Hora",
                value: "Última hora por sismo en la capital con cortes de energía",
                registerInstruction: "Registro: formal de última hora e impersonal. Lunfardo: no. Prioriza hechos confirmados.",
                icon: AlertOctagon,
                actions: [
                    { label: "Titular Urgente", value: "Leer un titular urgente", icon: Megaphone },
                    { label: "Confirmación Fuente", value: "Confirmar información con fuentes", icon: ShieldAlert },
                    { label: "Datos Preliminares", value: "Dar datos preliminares", icon: FileText },
                    { label: "Llamado Prudencia", value: "Pedir prudencia al público", icon: Hand },
                    { label: "Actualización", value: "Prometer actualización pronto", icon: Clock }
                ]
            },
            {
                label: "Cobertura de Crisis",
                value: "Cobertura en directo de derrame químico en un río",
                registerInstruction: "Registro: formal y sobrio. Lunfardo: no. Información verificada y tono sereno.",
                icon: Siren,
                actions: [
                    { label: "Balance de Daños", value: "Dar balance de daños", icon: AlertTriangle },
                    { label: "Rueda de Prensa", value: "Resumir rueda de prensa", icon: Mic },
                    { label: "Recursos Desplegados", value: "Describir recursos desplegados", icon: Truck },
                    { label: "Testimonio", value: "Transmitir un testimonio en directo", icon: MessageCircle },
                    { label: "Plan de Contingencia", value: "Explicar plan de contingencia", icon: ShieldAlert }
                ]
            },
            {
                label: "Investigación Especial",
                value: "Informe de investigación sobre red de sobornos en obra pública",
                registerInstruction: "Registro: formal periodístico. Lunfardo: no. Tono objetivo y preciso.",
                icon: Search,
                actions: [
                    { label: "Corrupción", value: "Destapar un caso de corrupción", icon: AlertTriangle },
                    { label: "Documentos Filtrados", value: "Citar documentos filtrados", icon: FileText },
                    { label: "Respuesta Oficial", value: "Presentar la respuesta oficial", icon: MessageCircle },
                    { label: "Impacto Político", value: "Analizar impacto político", icon: Globe },
                    { label: "Próximas Revelaciones", value: "Adelantar futuras revelaciones", icon: Eye }
                ]
            },
            {
                label: "Entrevista en Directo",
                value: "Segmento con resumen de preguntas y respuestas en conferencia de prensa",
                registerInstruction: "Registro: formal informativo. Lunfardo: no. Narrador resume el intercambio sin diálogo directo.",
                icon: Mic,
                actions: [
                    { label: "Pregunta Incómoda", value: "Mencionar una pregunta difícil que se realizó", icon: AlertTriangle },
                    { label: "Respuesta Evasiva", value: "Señalar una respuesta evasiva", icon: Eye },
                    { label: "Repregunta", value: "Resumir una repregunta clave", icon: Zap },
                    { label: "Dato Contrastado", value: "Citar un dato verificado", icon: CheckCircle },
                    { label: "Cierre con Titular", value: "Cerrar con una frase potente", icon: Megaphone }
                ]
            },
            {
                label: "Editorial del Día",
                value: "Editorial sobre política de vivienda y alquileres en la ciudad",
                registerInstruction: "Registro: formal argumentativo. Lunfardo: no. Opinión estructurada y respetuosa.",
                icon: MessageCircle,
                actions: [
                    { label: "Opinión", value: "Dar una opinión clara", icon: ThumbsUp },
                    { label: "Ejemplo Histórico", value: "Citar un ejemplo histórico", icon: BookOpen },
                    { label: "Crítica", value: "Criticar una decisión política", icon: ThumbsDown },
                    { label: "Propuesta", value: "Proponer una alternativa", icon: Lightbulb },
                    { label: "Conclusión", value: "Cerrar con conclusión contundente", icon: Star }
                ]
            },
            {
                label: "Economía de Mercados",
                value: "Informe de mercados con apertura de bolsa y riesgo país",
                registerInstruction: "Registro: formal financiero. Lunfardo: no. Datos y análisis sobrios.",
                icon: LineChart,
                actions: [
                    { label: "Movimiento Bursátil", value: "Describir movimientos de bolsa", icon: TrendingUp },
                    { label: "Indicadores", value: "Leer indicadores clave", icon: PieChart },
                    { label: "Reacción Inversores", value: "Contar reacción de inversores", icon: MessageCircle },
                    { label: "Consejo Prudente", value: "Dar consejo prudente", icon: ShieldAlert },
                    { label: "Análisis de Riesgo", value: "Analizar riesgos", icon: AlertTriangle }
                ]
            },
            {
                label: "Geopolítica",
                value: "Informe sobre cumbre regional y tensión en frontera",
                registerInstruction: "Registro: formal internacional. Lunfardo: no. Tono neutral y preciso.",
                icon: Globe,
                actions: [
                    { label: "Cumbre Internacional", value: "Resumir una cumbre internacional", icon: Map },
                    { label: "Declaración Conjunta", value: "Leer una declaración conjunta", icon: FileText },
                    { label: "Tensión Diplomática", value: "Explicar tensión diplomática", icon: AlertTriangle },
                    { label: "Reacción Países", value: "Describir reacciones", icon: Flag },
                    { label: "Proyección Futuro", value: "Proyectar escenarios", icon: Eye }
                ]
            },
            {
                label: "Cultura y Sociedad",
                value: "Debate cultural sobre inteligencia artificial en el arte",
                registerInstruction: "Registro: formal y reflexivo. Lunfardo: no. Argumentos claros y ordenados.",
                icon: Drama,
                actions: [
                    { label: "Censura", value: "Debatir sobre censura cultural", icon: Ban },
                    { label: "Impacto Artistas", value: "Explicar impacto en artistas", icon: Palette },
                    { label: "Opiniones Contrapuestas", value: "Comparar opiniones distintas", icon: Scale },
                    { label: "Contexto Histórico", value: "Dar contexto histórico", icon: BookOpen },
                    { label: "Cierre Reflexivo", value: "Cerrar con reflexión", icon: Brain }
                ]
            },
            {
                label: "Debate Electoral",
                value: "Informe sobre debate electoral con propuestas y cruces",
                registerInstruction: "Registro: formal político e impersonal. Lunfardo: no. Resumen objetivo.",
                icon: Flag,
                actions: [
                    { label: "Encuestas", value: "Dar datos de encuestas", icon: PieChart },
                    { label: "Propuestas", value: "Resumir propuestas clave", icon: FileText },
                    { label: "Cruce", value: "Describir un cruce relevante", icon: AlertTriangle },
                    { label: "Fiscalización", value: "Informar sobre fiscalización", icon: ShieldAlert },
                    { label: "Cierre", value: "Cerrar con dato relevante", icon: CheckCircle }
                ]
            },
            {
                label: "Informe de Defensa",
                value: "Informe sobre cooperación militar y presupuesto de defensa",
                registerInstruction: "Registro: formal internacional. Lunfardo: no. Datos precisos y tono sobrio.",
                icon: ShieldAlert,
                actions: [
                    { label: "Despliegue", value: "Informar sobre despliegue", icon: Map },
                    { label: "Presupuesto", value: "Dar cifra presupuestaria", icon: PieChart },
                    { label: "Cooperación", value: "Explicar un acuerdo de cooperación", icon: FileText },
                    { label: "Riesgos", value: "Mencionar riesgos regionales", icon: AlertTriangle },
                    { label: "Declaración", value: "Leer declaración oficial", icon: MessageCircle }
                ]
            }
        ]
    },
    [TextType.Monologue]: {
        [Level.Intro]: [
            {
                label: "El Día que Todo Salió Mal",
                value: "Monólogo sobre un día caótico: perdí el bus, llegué empapado al trabajo, se me cayó el café, y al final pasó algo bueno",
                registerInstruction: "Registro: informal cercano. Primera persona. Lunfardo: no. Frases claras y simples. Tono humorístico.",
                icon: Sun,
                actions: [
                    { label: "El Despertador Falló", value: "Contar cómo empezó mal el día: la alarma que no sonó", icon: Clock },
                    { label: "Corriendo al Bus", value: "Describir la carrera hacia el transporte y si lo perdió", icon: Bus },
                    { label: "La Lluvia", value: "Contar cómo le agarró la lluvia sin paraguas", icon: Umbrella },
                    { label: "El Accidente del Café", value: "Describir el momento vergonzoso del día", icon: Coffee },
                    { label: "La Sorpresa Final", value: "Contar algo bueno inesperado que salvó el día", icon: Star }
                ]
            },
            {
                label: "El Asado Dominical",
                value: "Monólogo sobre el ritual del asado familiar: quién cocina, las discusiones sobre la carne, el fútbol en la tele, los primos",
                registerInstruction: "Registro: informal afectivo. Primera persona, tono cálido. Lunfardo: no. Detalles sensoriales.",
                icon: Heart,
                actions: [
                    { label: "Los Preparativos", value: "Contar quién trae qué: la carne, la ensalada, el vino", icon: ShoppingBag },
                    { label: "El Asador", value: "Describir a quien hace el asado y sus rituales", icon: Utensils },
                    { label: "La Discusión sobre la Carne", value: "Contar la típica pelea entre quienes la quieren jugosa o cocida", icon: MessageCircle },
                    { label: "La Mesa", value: "Describir dónde se sientan todos y quién habla más", icon: UserPlus },
                    { label: "El Momento Favorito", value: "Contar qué momento disfruta más de la reunión", icon: Smile }
                ]
            },
            {
                label: "Mi Barrio Está Cambiando",
                value: "Monólogo sobre cómo el barrio ha cambiado: la panadería que cerró, el café hipster nuevo, los vecinos nuevos",
                registerInstruction: "Registro: informal descriptivo. Primera persona. Lunfardo: no. Tono nostálgico pero no triste.",
                icon: Map,
                actions: [
                    { label: "Antes y Ahora", value: "Comparar cómo era el barrio antes y cómo es ahora", icon: ArrowRight },
                    { label: "El Local que Cerró", value: "Contar sobre un negocio querido que ya no existe", icon: Frown },
                    { label: "Lo Nuevo", value: "Describir algo nuevo que apareció: café, negocio, edificio", icon: Sparkles },
                    { label: "Los Vecinos", value: "Hablar de si los vecinos son los mismos o hay nuevos", icon: UserPlus },
                    { label: "Mi Opinión", value: "Decir si le gustan los cambios o no y por qué", icon: Brain }
                ]
            },
            {
                label: "Cómo Adopté a Mi Perro",
                value: "Monólogo sobre el día que adoptó un perro del refugio: la decisión, el primer encuentro, la primera noche en casa",
                registerInstruction: "Registro: informal y tierno. Primera persona. Lunfardo: no. Emociones claras.",
                icon: Dog,
                actions: [
                    { label: "La Decisión", value: "Contar por qué decidió adoptar y no comprar", icon: Lightbulb },
                    { label: "El Refugio", value: "Describir cómo era el refugio y los otros perros", icon: Home },
                    { label: "El Primer Encuentro", value: "Contar el momento de ver a su perro por primera vez", icon: Heart },
                    { label: "El Viaje a Casa", value: "Describir cómo fue traerlo a casa: nervioso, tranquilo", icon: Car },
                    { label: "La Primera Noche", value: "Contar cómo fue la primera noche: dónde durmió, si lloró", icon: Moon }
                ]
            },
            {
                label: "El Cumpleaños Sorpresa que Salió Mal",
                value: "Monólogo sobre un cumpleaños sorpresa que no fue como esperaban: el festejado llegó antes, el pastel se cayó",
                registerInstruction: "Registro: informal emotivo y humorístico. Primera persona. Lunfardo: no.",
                icon: Smile,
                actions: [
                    { label: "El Plan Original", value: "Contar cuál era el plan para la sorpresa", icon: ListChecks },
                    { label: "Los Preparativos", value: "Describir cómo decoraron y qué cocinaron", icon: Gift },
                    { label: "El Primer Desastre", value: "Contar el primer problema: el pastel, los globos, el disfraz", icon: AlertTriangle },
                    { label: "La Llegada Inesperada", value: "Describir si el festejado llegó antes de tiempo", icon: DoorOpen },
                    { label: "Cómo Terminó", value: "Contar si igual fue divertido a pesar del caos", icon: Smile }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Viaje Corto",
                value: "Relato de escapada a un pueblo costero con bus nocturno",
                registerInstruction: "Registro: informal narrativo. Primera persona, orden cronológico. Lunfardo: no.",
                icon: Plane,
                actions: [
                    { label: "Planificación", value: "Contar cómo planeó el viaje", icon: Calendar },
                    { label: "Transporte", value: "Decir cómo llegó", icon: Train },
                    { label: "Lugar Visitado", value: "Describir un lugar visitado", icon: MapPin },
                    { label: "Problema", value: "Contar un problema pequeño", icon: AlertTriangle },
                    { label: "Recomendación", value: "Dar un consejo para otros", icon: ThumbsUp }
                ]
            },
            {
                label: "Primer Trabajo/Clase",
                value: "Relato del primer día en una cafetería universitaria",
                registerInstruction: "Registro: informal respetuoso. Primera persona. Lunfardo: no.",
                icon: Briefcase,
                actions: [
                    { label: "Contexto", value: "Explicar cómo empezó", icon: BookOpen },
                    { label: "Tarea Principal", value: "Describir la tarea principal", icon: Hand },
                    { label: "Persona Conocida", value: "Mencionar a alguien importante", icon: UserPlus },
                    { label: "Dificultad", value: "Contar una dificultad", icon: AlertCircle },
                    { label: "Lección", value: "Explicar lo aprendido", icon: Lightbulb }
                ]
            },
            {
                label: "Día Difícil",
                value: "Monólogo sobre un día complicado con corte de luz y llegar tarde",
                registerInstruction: "Registro: informal emotivo pero claro. Primera persona. Lunfardo: no.",
                icon: Frown,
                actions: [
                    { label: "Qué Salió Mal", value: "Explicar qué fue mal", icon: AlertTriangle },
                    { label: "Cómo Lo Resolví", value: "Contar la solución", icon: Wrench },
                    { label: "Ayuda Recibida", value: "Mencionar ayuda", icon: Hand },
                    { label: "Sentimientos", value: "Expresar emociones", icon: Heart },
                    { label: "Resultado", value: "Decir cómo terminó", icon: CheckCircle }
                ]
            },
            {
                label: "Receta en Casa",
                value: "Monólogo explicando una tortilla de papas paso a paso",
                registerInstruction: "Registro: informal instructivo. Primera persona o impersonal. Lunfardo: no.",
                icon: Utensils,
                actions: [
                    { label: "Ingredientes", value: "Listar ingredientes básicos", icon: Menu },
                    { label: "Pasos", value: "Explicar pasos simples", icon: Hand },
                    { label: "Tiempo", value: "Decir tiempo de preparación", icon: Clock },
                    { label: "Consejo", value: "Dar un consejo de cocina", icon: Smile },
                    { label: "Resultado", value: "Describir el resultado", icon: Star }
                ]
            },
            {
                label: "Una Amistad",
                value: "Relato de amistad nacida en un curso de idioma",
                registerInstruction: "Registro: informal cercano y positivo. Primera persona. Lunfardo: no.",
                icon: HeartHandshake,
                actions: [
                    { label: "Cómo Se Conocieron", value: "Contar cómo se conocieron", icon: UserPlus },
                    { label: "Actividad Favorita", value: "Describir actividad favorita", icon: Smile },
                    { label: "Conflicto Pequeño", value: "Contar un conflicto", icon: AlertCircle },
                    { label: "Solución", value: "Explicar cómo lo resolvieron", icon: CheckCircle },
                    { label: "Importancia", value: "Decir por qué es importante", icon: Heart }
                ]
            },
            {
                label: "Evento Cultural",
                value: "Monólogo sobre un festival de cine barrial en un centro cultural",
                registerInstruction: "Registro: informal descriptivo. Primera persona, tono respetuoso. Lunfardo: no.",
                icon: Music,
                actions: [
                    { label: "Dónde Fue", value: "Decir dónde fue", icon: MapPin },
                    { label: "Qué Vi", value: "Describir lo que vio", icon: Eye },
                    { label: "Qué Me Gustó", value: "Decir qué le gustó", icon: ThumbsUp },
                    { label: "Qué No", value: "Decir qué no le gustó", icon: ThumbsDown },
                    { label: "Invitación", value: "Invitar a otros", icon: Ticket }
                ]
            },
            {
                label: "Mudanza",
                value: "Monólogo sobre una mudanza a un departamento pequeño",
                registerInstruction: "Registro: informal narrativo. Primera persona. Lunfardo: no.",
                icon: Home,
                actions: [
                    { label: "Preparación", value: "Contar cómo preparó las cajas", icon: ListChecks },
                    { label: "Ayuda", value: "Mencionar quién ayudó", icon: Hand },
                    { label: "Problema", value: "Contar un problema durante la mudanza", icon: AlertTriangle },
                    { label: "Emoción", value: "Expresar cómo se sintió", icon: Heart },
                    { label: "Resultado", value: "Decir cómo terminó todo", icon: CheckCircle }
                ]
            },
            {
                label: "Primer Día de Gimnasio",
                value: "Monólogo sobre el primer día de gimnasio",
                registerInstruction: "Registro: informal motivador. Primera persona. Lunfardo: no.",
                icon: Dumbbell,
                actions: [
                    { label: "Expectativa", value: "Contar qué esperaba", icon: Lightbulb },
                    { label: "Ejercicio", value: "Describir un ejercicio que hizo", icon: Hand },
                    { label: "Dificultad", value: "Contar una dificultad", icon: AlertCircle },
                    { label: "Consejo", value: "Dar un consejo simple", icon: ThumbsUp },
                    { label: "Emoción", value: "Decir cómo se sintió", icon: Smile }
                ]
            },
            {
                label: "Aprender a Conducir",
                value: "Monólogo sobre clases de conducción en ciudad",
                registerInstruction: "Registro: informal claro. Primera persona. Lunfardo: no.",
                icon: Car,
                actions: [
                    { label: "Clases", value: "Contar cómo son las clases", icon: Calendar },
                    { label: "Error", value: "Mencionar un error cometido", icon: AlertTriangle },
                    { label: "Instructor", value: "Describir al instructor", icon: UserPlus },
                    { label: "Miedo", value: "Expresar un miedo", icon: Frown },
                    { label: "Progreso", value: "Contar un avance", icon: TrendingUp }
                ]
            },
            {
                label: "Celebración de Barrio",
                value: "Monólogo sobre una fiesta barrial con música y comidas",
                registerInstruction: "Registro: informal descriptivo. Primera persona. Lunfardo: no.",
                icon: Music,
                actions: [
                    { label: "Preparación", value: "Describir la preparación", icon: ListChecks },
                    { label: "Actividad", value: "Contar una actividad principal", icon: Flag },
                    { label: "Encuentro", value: "Mencionar con quién se encontró", icon: UserPlus },
                    { label: "Comida", value: "Describir la comida típica", icon: Utensils },
                    { label: "Cierre", value: "Cerrar con una sensación final", icon: Heart }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Decisión Importante",
                value: "Monólogo sobre la decisión de mudarse por una beca",
                registerInstruction: "Registro: semi-formal reflexivo. Primera persona. Lunfardo: no.",
                icon: Scale,
                actions: [
                    { label: "Contexto", value: "Explicar el contexto", icon: FileText },
                    { label: "Opciones", value: "Presentar opciones", icon: Scale },
                    { label: "Dudas", value: "Expresar dudas", icon: Frown },
                    { label: "Decisión", value: "Contar la decisión final", icon: CheckCircle },
                    { label: "Consecuencia", value: "Explicar la consecuencia", icon: ArrowRight }
                ]
            },
            {
                label: "Problema y Solución",
                value: "Relato de un proyecto grupal que falló y cómo se reorganizó",
                registerInstruction: "Registro: semi-formal narrativo. Primera persona. Lunfardo: no.",
                icon: AlertTriangle,
                actions: [
                    { label: "Problema", value: "Describir el problema", icon: AlertTriangle },
                    { label: "Pasos", value: "Explicar los pasos para resolverlo", icon: ListChecks },
                    { label: "Obstáculo", value: "Mencionar un obstáculo", icon: X },
                    { label: "Resultado", value: "Contar el resultado", icon: CheckCircle },
                    { label: "Reflexión", value: "Reflexionar sobre lo aprendido", icon: Brain }
                ]
            },
            {
                label: "Historia de Superación",
                value: "Monólogo sobre volver a entrenar tras una lesión deportiva",
                registerInstruction: "Registro: informal motivador. Primera persona. Lunfardo: no.",
                icon: TrendingUp,
                actions: [
                    { label: "Dificultad", value: "Describir dificultad inicial", icon: AlertCircle },
                    { label: "Esfuerzo", value: "Contar el esfuerzo", icon: Dumbbell },
                    { label: "Apoyo", value: "Mencionar apoyo recibido", icon: Heart },
                    { label: "Logro", value: "Describir el logro", icon: Star },
                    { label: "Aprendizaje", value: "Cierre con aprendizaje", icon: Lightbulb }
                ]
            },
            {
                label: "Relato de Ciudad",
                value: "Monólogo sobre cambios en la ciudad por nueva línea de metro",
                registerInstruction: "Registro: semi-formal descriptivo. Primera persona. Lunfardo: no.",
                icon: Building,
                actions: [
                    { label: "Cambio", value: "Explicar un cambio reciente", icon: Sparkles },
                    { label: "Causa", value: "Describir causas", icon: Search },
                    { label: "Reacción", value: "Contar reacción de la gente", icon: MessageCircle },
                    { label: "Balance", value: "Hablar de beneficios y problemas", icon: Scale },
                    { label: "Deseo Futuro", value: "Expresar un deseo futuro", icon: Star }
                ]
            },
            {
                label: "Crónica de Evento",
                value: "Relato cronológico de una maratón solidaria en la ciudad",
                registerInstruction: "Registro: semi-formal narrativo. Primera persona. Lunfardo: no.",
                icon: Calendar,
                actions: [
                    { label: "Inicio", value: "Describir el inicio", icon: Flag },
                    { label: "Momento Clave", value: "Narrar el momento clave", icon: Zap },
                    { label: "Ambiente", value: "Describir el ambiente", icon: Music },
                    { label: "Opinión", value: "Dar opinión personal", icon: ThumbsUp },
                    { label: "Conclusión", value: "Cerrar la crónica", icon: CheckCircle }
                ]
            },
            {
                label: "Reflexión Cultural",
                value: "Monólogo sobre la tradición del mate y cambios generacionales",
                registerInstruction: "Registro: semi-formal reflexivo. Primera persona. Lunfardo: no.",
                icon: Palette,
                actions: [
                    { label: "Tradición", value: "Explicar una tradición", icon: BookOpen },
                    { label: "Valor Cultural", value: "Describir su valor", icon: Heart },
                    { label: "Cambio Generacional", value: "Comparar generaciones", icon: Scale },
                    { label: "Experiencia", value: "Contar experiencia personal", icon: MessageCircle },
                    { label: "Conclusión", value: "Cerrar con reflexión", icon: Brain }
                ]
            },
            {
                label: "Carta Abierta",
                value: "Monólogo en forma de carta a la municipalidad por espacios verdes",
                registerInstruction: "Registro: formal epistolar. Primera persona dirigida a un destinatario. Lunfardo: no.",
                icon: FileText,
                actions: [
                    { label: "Destinatario", value: "Decir a quién va la carta", icon: UserPlus },
                    { label: "Motivo", value: "Explicar el motivo", icon: MessageCircle },
                    { label: "Argumento", value: "Desarrollar argumento principal", icon: Scale },
                    { label: "Ejemplo", value: "Dar un ejemplo concreto", icon: Search },
                    { label: "Cierre Emotivo", value: "Cerrar con tono emotivo", icon: Heart }
                ]
            },
            {
                label: "Cambio de Trabajo",
                value: "Monólogo sobre dejar un empleo y empezar otro",
                registerInstruction: "Registro: semi-formal reflexivo. Primera persona. Lunfardo: no.",
                icon: Briefcase,
                actions: [
                    { label: "Motivo", value: "Explicar el motivo del cambio", icon: MessageCircle },
                    { label: "Transición", value: "Contar cómo fue la transición", icon: ArrowRight },
                    { label: "Miedo", value: "Expresar un miedo o duda", icon: Frown },
                    { label: "Aprendizaje", value: "Describir un aprendizaje", icon: Lightbulb },
                    { label: "Resultado", value: "Contar el resultado final", icon: CheckCircle }
                ]
            },
            {
                label: "Proyecto Creativo",
                value: "Monólogo sobre un proyecto artístico personal",
                registerInstruction: "Registro: semi-formal narrativo. Primera persona. Lunfardo: no.",
                icon: Palette,
                actions: [
                    { label: "Idea", value: "Describir la idea inicial", icon: Lightbulb },
                    { label: "Proceso", value: "Contar el proceso de trabajo", icon: ListChecks },
                    { label: "Bloqueo", value: "Mencionar un bloqueo creativo", icon: AlertCircle },
                    { label: "Solución", value: "Explicar cómo lo resolvió", icon: Wrench },
                    { label: "Balance", value: "Hacer un balance final", icon: Scale }
                ]
            },
            {
                label: "Viaje en Solitario",
                value: "Monólogo sobre viajar solo por primera vez",
                registerInstruction: "Registro: semi-formal narrativo. Primera persona. Lunfardo: no.",
                icon: Plane,
                actions: [
                    { label: "Decisión", value: "Contar por qué decidió viajar", icon: CheckCircle },
                    { label: "Logística", value: "Describir la logística del viaje", icon: Calendar },
                    { label: "Desafío", value: "Contar un desafío", icon: AlertTriangle },
                    { label: "Encuentro", value: "Narrar un encuentro interesante", icon: UserPlus },
                    { label: "Reflexión", value: "Cerrar con una reflexión", icon: Brain }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Ensayo Personal",
                value: "Monólogo con tesis sobre trabajo remoto y vida urbana",
                registerInstruction: "Registro: formal argumentativo. Primera persona moderada. Lunfardo: no.",
                icon: FileText,
                actions: [
                    { label: "Tesis", value: "Presentar una tesis personal", icon: Lightbulb },
                    { label: "Argumento", value: "Desarrollar argumento principal", icon: Scale },
                    { label: "Contraargumento", value: "Incluir contraargumento", icon: X },
                    { label: "Ejemplo", value: "Dar un ejemplo claro", icon: Search },
                    { label: "Cierre", value: "Cerrar con conclusión", icon: CheckCircle }
                ]
            },
            {
                label: "Confesión y Catarsis",
                value: "Monólogo íntimo sobre dejar una carrera universitaria",
                registerInstruction: "Registro: informal íntimo y serio. Primera persona. Lunfardo: no.",
                icon: Heart,
                actions: [
                    { label: "Confesión", value: "Confesar un hecho", icon: Lock },
                    { label: "Contexto Emocional", value: "Explicar emociones", icon: Frown },
                    { label: "Consecuencias", value: "Describir consecuencias", icon: AlertTriangle },
                    { label: "Responsabilidad", value: "Asumir responsabilidad", icon: Hand },
                    { label: "Aprendizaje", value: "Cerrar con aprendizaje", icon: Star }
                ]
            },
            {
                label: "Crónica de Investigación",
                value: "Monólogo investigativo sobre comedores escolares y presupuestos",
                registerInstruction: "Registro: formal periodístico. Primera persona con tono objetivo. Lunfardo: no.",
                icon: Search,
                actions: [
                    { label: "Inicio", value: "Explicar cómo empezó", icon: Flag },
                    { label: "Fuentes", value: "Describir fuentes consultadas", icon: FileText },
                    { label: "Hallazgo", value: "Revelar hallazgo clave", icon: Sparkles },
                    { label: "Reacción", value: "Contar reacciones", icon: MessageCircle },
                    { label: "Conclusión", value: "Cerrar con conclusión", icon: CheckCircle }
                ]
            },
            {
                label: "Relato Literario",
                value: "Monólogo literario ambientado en una estación de tren nocturna",
                registerInstruction: "Registro: literario cuidado. Primera persona o narrador. Lunfardo: no.",
                icon: BookOpen,
                actions: [
                    { label: "Inicio Atmosférico", value: "Crear ambiente inicial", icon: Moon },
                    { label: "Giro Inesperado", value: "Narrar un giro", icon: Zap },
                    { label: "Personaje", value: "Desarrollar personaje", icon: UserPlus },
                    { label: "Clímax", value: "Narrar clímax", icon: AlertTriangle },
                    { label: "Final Abierto", value: "Cerrar con final abierto", icon: Eye }
                ]
            },
            {
                label: "Discurso Motivacional",
                value: "Discurso para graduación con llamado a la acción",
                registerInstruction: "Registro: semi-formal inspirador. Primera persona. Lunfardo: no.",
                icon: Megaphone,
                actions: [
                    { label: "Historia Personal", value: "Contar historia personal", icon: Heart },
                    { label: "Obstáculo", value: "Describir un obstáculo", icon: AlertCircle },
                    { label: "Mensaje Inspirador", value: "Dar mensaje inspirador", icon: Sparkles },
                    { label: "Llamado a la Acción", value: "Invitar a actuar", icon: ArrowRight },
                    { label: "Cierre Potente", value: "Cerrar con frase potente", icon: Star }
                ]
            },
            {
                label: "Análisis Social",
                value: "Monólogo analítico sobre alquileres y acceso a vivienda",
                registerInstruction: "Registro: formal analítico. Primera persona moderada. Lunfardo: no.",
                icon: Globe,
                actions: [
                    { label: "Problema Social", value: "Describir un problema social", icon: AlertTriangle },
                    { label: "Datos", value: "Mencionar datos o evidencia", icon: PieChart },
                    { label: "Causas", value: "Analizar causas estructurales", icon: Brain },
                    { label: "Impacto Humano", value: "Hablar del impacto humano", icon: Heart },
                    { label: "Propuesta", value: "Proponer una acción", icon: Lightbulb }
                ]
            },
            {
                label: "Memoria Histórica",
                value: "Monólogo sobre una migración familiar tras una crisis económica",
                registerInstruction: "Registro: formal y respetuoso. Primera persona o narrador. Lunfardo: no.",
                icon: BookOpen,
                actions: [
                    { label: "Contexto", value: "Dar contexto histórico", icon: Calendar },
                    { label: "Testimonio", value: "Citar un testimonio", icon: MessageCircle },
                    { label: "Detalle Simbólico", value: "Describir un símbolo", icon: Star },
                    { label: "Reflexión", value: "Reflexionar sobre el pasado", icon: Brain },
                    { label: "Lección", value: "Extraer una lección", icon: Lightbulb }
                ]
            },
            {
                label: "Monólogo Humorístico",
                value: "Monólogo con humor sobre trámites burocráticos y ventanillas",
                registerInstruction: "Registro: informal humorístico. Primera persona. Lunfardo: permitido leve si no ofende.",
                icon: Smile,
                actions: [
                    { label: "Tema Cotidiano", value: "Elegir un tema cotidiano", icon: Home },
                    { label: "Exageración", value: "Usar exageración", icon: Zap },
                    { label: "Comparación", value: "Hacer una comparación graciosa", icon: Scale },
                    { label: "Remate", value: "Preparar el remate", icon: Megaphone },
                    { label: "Cierre", value: "Cerrar con broma", icon: ThumbsUp }
                ]
            },
            {
                label: "Discurso de Despedida",
                value: "Monólogo de despedida en un cierre de etapa",
                registerInstruction: "Registro: formal emotivo. Primera persona. Lunfardo: no.",
                icon: Heart,
                actions: [
                    { label: "Agradecimiento", value: "Agradecer a personas clave", icon: ThumbsUp },
                    { label: "Recuerdo", value: "Recordar un momento importante", icon: Star },
                    { label: "Legado", value: "Hablar del legado dejado", icon: BookOpen },
                    { label: "Consejo", value: "Dar un consejo final", icon: Lightbulb },
                    { label: "Cierre", value: "Cerrar con una frase emotiva", icon: MessageCircle }
                ]
            }
        ]
    }
};
