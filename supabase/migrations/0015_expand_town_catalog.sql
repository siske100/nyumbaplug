-- Expand the town picker with the areas, estates and towns used in rental searches.
-- County IDs match the catalog in seed/seed.sql. Re-running this is safe.
insert into counties(id, name) values
  (1,'Mombasa'),(2,'Kwale'),(3,'Kilifi'),(4,'Tana River'),(5,'Lamu'),(6,'Taita-Taveta'),(7,'Garissa'),(8,'Wajir'),(9,'Mandera'),(10,'Marsabit'),
  (11,'Isiolo'),(12,'Meru'),(13,'Tharaka-Nithi'),(14,'Embu'),(15,'Kitui'),(16,'Machakos'),(17,'Makueni'),(18,'Nyandarua'),(19,'Nyeri'),(20,'Kirinyaga'),
  (21,'Murang''a'),(22,'Kiambu'),(23,'Turkana'),(24,'West Pokot'),(25,'Samburu'),(26,'Trans Nzoia'),(27,'Uasin Gishu'),(28,'Elgeyo-Marakwet'),(29,'Nandi'),(30,'Baringo'),
  (31,'Laikipia'),(32,'Nakuru'),(33,'Narok'),(34,'Kajiado'),(35,'Kericho'),(36,'Bomet'),(37,'Kakamega'),(38,'Vihiga'),(39,'Bungoma'),(40,'Busia'),
  (41,'Siaya'),(42,'Kisumu'),(43,'Homa Bay'),(44,'Migori'),(45,'Kisii'),(46,'Nyamira'),(47,'Nairobi')
on conflict (id) do nothing;

insert into towns(county_id, name) values
  -- Mombasa
  (1,'Mombasa Old Town'),(1,'Ganjoni'),(1,'Tudor'),(1,'Mbaraki'),(1,'Majengo'),(1,'Tononoka'),(1,'Makupa'),(1,'Kizingo'),
  (1,'Mkomani'),(1,'Kongowea'),(1,'Mtopanga'),(1,'Bamburi'),(1,'Shanzu'),(1,'Mkundi'),(1,'Kisauni'),(1,'Bombolulu'),
  (1,'Mwandoni'),(1,'Utange'),(1,'Mjambere'),(1,'Shelly Beach'),(1,'Mtongwe'),(1,'Timbwani'),(1,'Bofu'),(1,'Likoni Ferry'),
  (1,'Changamwe'),(1,'Chaani'),(1,'Port Reitz'),(1,'Miritini'),(1,'Airport'),(1,'Magongo'),(1,'Kipevu'),(1,'Jomvu'),
  (1,'Mikindani'),(1,'Kwa Jomvu'),(1,'Mwiyane'),
  -- Kwale
  (2,'Kwale'),(2,'Ukunda'),(2,'Diani'),(2,'Msambweni'),(2,'Kinango'),(2,'Lunga Lunga'),(2,'Kikoneni'),(2,'Mazeras'),
  (2,'Shimba Hills'),(2,'Mwaluphamba'),
  -- Kilifi
  (3,'Kilifi'),(3,'Malindi'),(3,'Mtwapa'),(3,'Watamu'),(3,'Mariakani'),(3,'Kaloleni'),(3,'Mazeras'),(3,'Bamba'),
  (3,'Gede'),(3,'Ganze'),(3,'Kikambala'),(3,'Takaungu'),(3,'Magarini'),(3,'Gongoni'),
  -- Tana River
  (4,'Hola'),(4,'Garsen'),(4,'Bura'),(4,'Madogo'),(4,'Kipini'),(4,'Wenje'),
  -- Lamu
  (5,'Lamu'),(5,'Mokowe'),(5,'Mpeketoni'),(5,'Witu'),(5,'Faza'),(5,'Kiunga'),(5,'Hindi'),(5,'Hongwe'),
  -- Taita-Taveta
  (6,'Wundanyi'),(6,'Voi'),(6,'Taveta'),(6,'Mwatate'),(6,'Wusi'),(6,'Bura Tsavo'),(6,'Maungu'),(6,'Mgange'),
  -- Garissa
  (7,'Garissa'),(7,'Dadaab'),(7,'Masalani'),(7,'Balambala'),(7,'Hulugho'),(7,'Bura East'),(7,'Modogashe'),(7,'Ijara'),(7,'Liboi'),
  -- Wajir
  (8,'Wajir'),(8,'Habaswein'),(8,'Bute'),(8,'Griftu'),(8,'Eldas'),(8,'Tarbaj'),(8,'Buna'),(8,'Hadado'),
  -- Mandera
  (9,'Mandera'),(9,'Elwak'),(9,'Rhamu'),(9,'Takaba'),(9,'Lafey'),(9,'Banisa'),(9,'Kutulo'),
  -- Marsabit
  (10,'Marsabit'),(10,'Moyale'),(10,'Sololo'),(10,'Laisamis'),(10,'Loiyangalani'),(10,'North Horr'),(10,'Maikona'),(10,'Kalacha'),
  -- Isiolo
  (11,'Isiolo'),(11,'Merti'),(11,'Garbatulla'),(11,'Kinna'),(11,'Oldonyiro'),(11,'Sericho'),
  -- Meru
  (12,'Meru'),(12,'Maua'),(12,'Nkubu'),(12,'Timau'),(12,'Mitunguu'),(12,'Kianjai'),(12,'Laare'),(12,'Mikinduri'),
  (12,'Kangeta'),(12,'Kiirua'),(12,'Kithirune'),
  -- Tharaka-Nithi
  (13,'Kathwana'),(13,'Chuka'),(13,'Chogoria'),(13,'Marimanti'),(13,'Gatunga'),(13,'Kibugua'),
  -- Embu
  (14,'Embu'),(14,'Runyenjes'),(14,'Siakago'),(14,'Manyatta'),(14,'Kiritiri'),(14,'Ishiara'),(14,'Kianjokoma'),
  -- Kitui
  (15,'Kitui'),(15,'Mwingi'),(15,'Mutomo'),(15,'Zombe'),(15,'Kwa Vonza'),(15,'Kyuso'),(15,'Migwani'),(15,'Ikutha'),
  (15,'Mutito'),(15,'Kibwezi (road side)'),
  -- Machakos
  (16,'Machakos'),(16,'Athi River'),(16,'Mlolongo'),(16,'Syokimau'),(16,'Kangundo'),(16,'Tala'),(16,'Matuu'),
  (16,'Masinga'),(16,'Katani'),(16,'Kathiani'),(16,'Mwala'),
  -- Makueni
  (17,'Wote'),(17,'Emali'),(17,'Makindu'),(17,'Sultan Hamud'),(17,'Kibwezi'),(17,'Mtito Andei'),(17,'Kilome'),(17,'Nunguni'),
  -- Nyandarua
  (18,'Ol Kalou'),(18,'Engineer'),(18,'Njabini'),(18,'Ndaragwa'),(18,'Ol Joro Orok'),(18,'Kinangop'),(18,'Mairo Inya'),
  (18,'Nyahururu (border)'),(18,'Geta'),
  -- Nyeri
  (19,'Nyeri'),(19,'Karatina'),(19,'Othaya'),(19,'Mukurwe-ini'),(19,'Naro Moru'),(19,'Mweiga'),(19,'Chaka'),
  (19,'Mathari'),(19,'Kiganjo'),(19,'Tetu'),
  -- Kirinyaga
  (20,'Kerugoya'),(20,'Kutus'),(20,'Sagana'),(20,'Wanguru'),(20,'Mwea'),(20,'Kianyaga'),(20,'Baricho'),(20,'Kagio'),(20,'Ngurubani'),
  -- Murang'a
  (21,'Murang''a'),(21,'Kenol'),(21,'Maragua'),(21,'Kandara'),(21,'Kangari'),(21,'Kahuro'),(21,'Makuyu'),(21,'Kigumo'),(21,'Muthithi'),
  -- Kiambu
  (22,'Kiambu'),(22,'Ndumberi'),(22,'Riabai'),(22,'Kiambaa'),(22,'Ruaka'),(22,'Banana'),(22,'Thika Town'),(22,'Makongeni'),
  (22,'Landless'),(22,'Biashara'),(22,'Kiganjo'),(22,'Gatuanyaga'),(22,'Ngoliba'),(22,'Gatura'),(22,'Ruiru'),
  (22,'Kahawa Sukari'),(22,'Wendani'),(22,'Kimbo'),(22,'Membley'),(22,'Githurai Kimbo'),(22,'Juja'),(22,'Gachororo'),
  (22,'Theta'),(22,'Witeithie'),(22,'Kalimoni'),(22,'Limuru'),(22,'Tigoni'),(22,'Ndeiya'),(22,'Karuri'),
  (22,'Kikuyu'),(22,'Kinoo'),(22,'Zambezi'),(22,'Muguga'),(22,'Thogoto'),(22,'Kabete'),(22,'Wangige'),
  (22,'Gachie'),(22,'Rironi'),(22,'Kamandura'),(22,'Githunguri'),(22,'Githiga'),(22,'Gatundu'),(22,'Kamwangi'),
  (22,'Ndarugu'),(22,'Ndenderu'),(22,'Lari'),(22,'Kijabe'),(22,'Kimende'),(22,'Kagwe'),(22,'Nachu'),
  -- Turkana
  (23,'Lodwar'),(23,'Kakuma'),(23,'Lokichoggio'),(23,'Kalokol'),(23,'Lokichar'),(23,'Lokitaung'),(23,'Kainuk'),
  -- West Pokot
  (24,'Kapenguria'),(24,'Makutano'),(24,'Sigor'),(24,'Chepareria'),(24,'Ortum'),(24,'Kacheliba'),(24,'Alale'),
  -- Samburu
  (25,'Maralal'),(25,'Baragoi'),(25,'Wamba'),(25,'Archers Post'),(25,'South Horr'),(25,'Kisima'),
  -- Trans Nzoia
  (26,'Kitale'),(26,'Kiminini'),(26,'Endebess'),(26,'Cherangany'),(26,'Saboti'),(26,'Kwanza'),(26,'Hospital'),
  -- Uasin Gishu
  (27,'Eldoret'),(27,'Turbo'),(27,'Burnt Forest'),(27,'Moiben'),(27,'Soy'),(27,'Ziwa'),(27,'Kesses'),(27,'Kapseret'),(27,'Jua Kali'),
  -- Elgeyo-Marakwet
  (28,'Iten'),(28,'Kapsowar'),(28,'Tambach'),(28,'Chebiemit'),(28,'Kaptarakwa'),(28,'Chepkorio'),
  -- Nandi
  (29,'Kapsabet'),(29,'Nandi Hills'),(29,'Mosoriot'),(29,'Kobujoi'),(29,'Kaiboi'),(29,'Chepterit'),(29,'Lessos'),(29,'Kabiyet'),
  -- Baringo
  (30,'Kabarnet'),(30,'Eldama Ravine'),(30,'Marigat'),(30,'Chemolingot'),(30,'Mogotio'),(30,'Kabartonjo'),(30,'Kampi ya Samaki'),
  -- Laikipia
  (31,'Rumuruti'),(31,'Nanyuki'),(31,'Nyahururu'),(31,'Doldol'),(31,'Ol Pejeta area'),(31,'Kinamba'),(31,'Sipili'),(31,'Naibor'),
  -- Nakuru
  (32,'Nakuru'),(32,'Naivasha'),(32,'Gilgil'),(32,'Molo'),(32,'Njoro'),(32,'Subukia'),(32,'Rongai'),(32,'Mai Mahiu'),
  (32,'Bahati'),(32,'Elementaita'),(32,'Salgaa'),
  -- Narok
  (33,'Narok'),(33,'Kilgoris'),(33,'Ololulunga'),(33,'Suswa'),(33,'Lemek'),(33,'Mulot'),(33,'Ntulele'),
  -- Kajiado
  (34,'Kajiado'),(34,'Kitengela'),(34,'Ngong'),(34,'Ongata Rongai'),(34,'Kiserian'),(34,'Namanga'),(34,'Loitokitok'),
  (34,'Isinya'),(34,'Bissil'),(34,'Mashuuru'),
  -- Kericho
  (35,'Kericho'),(35,'Litein'),(35,'Londiani'),(35,'Kipkelion'),(35,'Kapsoit'),(35,'Fort Tenan'),(35,'Sosiot'),(35,'Kapkatet'),
  -- Bomet
  (36,'Bomet'),(36,'Sotik'),(36,'Longisa'),(36,'Mogogosiek'),(36,'Silibwet'),(36,'Chebunyo'),
  -- Kakamega
  (37,'Kakamega'),(37,'Mumias'),(37,'Butere'),(37,'Malava'),(37,'Khayega'),(37,'Lugari'),(37,'Likuyani'),(37,'Matungu'),
  (37,'Shinyalu'),(37,'Lurambi'),
  -- Vihiga
  (38,'Mbale'),(38,'Luanda'),(38,'Chavakali'),(38,'Hamisi'),(38,'Majengo'),(38,'Kaimosi'),(38,'Gisambai'),
  -- Bungoma
  (39,'Bungoma'),(39,'Webuye'),(39,'Kimilili'),(39,'Malakisi'),(39,'Chwele'),(39,'Naitiri'),(39,'Sirisia'),(39,'Kapsokwony'),(39,'Cheptais'),
  -- Busia
  (40,'Busia'),(40,'Malaba'),(40,'Funyula'),(40,'Nambale'),(40,'Port Victoria'),(40,'Butula'),(40,'Bumala'),(40,'Mundika'),
  -- Siaya
  (41,'Siaya'),(41,'Bondo'),(41,'Ugunja'),(41,'Yala'),(41,'Usenge'),(41,'Ukwala'),(41,'Sidindi'),(41,'Aram'),
  -- Kisumu
  (42,'Kisumu CBD'),(42,'Milimani'),(42,'Kondele'),(42,'Nyalenda'),(42,'Manyatta'),(42,'Mamboleo'),(42,'Tom Mboya'),
  (42,'Migosi'),(42,'Mountain View'),(42,'Kibuye'),(42,'Kajulu'),(42,'Kolwa'),(42,'Kibos'),(42,'Chemelil'),
  (42,'Miwani'),(42,'Otonglo'),(42,'Ahero'),(42,'Maseno'),(42,'Chulaimbo'),(42,'Kisian'),(42,'Dunga'),
  (42,'Kombewa'),(42,'Holo'),(42,'Awasi'),(42,'Kobura'),(42,'Rabuor'),(42,'Katito'),(42,'Kadibo'),
  (42,'Muhoroni'),(42,'Fort Ternan'),(42,'Koru'),(42,'Pap Onditi'),(42,'Sondu'),(42,'Ombeyi'),(42,'Rangul'),
  (42,'Kasaye'),(42,'Seme'),(42,'Usoma'),(42,'Luanda Kotieno'),
  -- Homa Bay
  (43,'Homa Bay'),(43,'Mbita'),(43,'Kendu Bay'),(43,'Oyugis'),(43,'Ndhiwa'),(43,'Rod Kopany'),(43,'Kabondo'),(43,'Rangwe'),(43,'Sindo'),
  -- Migori
  (44,'Migori'),(44,'Awendo'),(44,'Rongo'),(44,'Isebania'),(44,'Kehancha'),(44,'Uriri'),(44,'Macalder'),(44,'Muhuru Bay'),(44,'Suna'),
  -- Kisii
  (45,'Kisii'),(45,'Ogembo'),(45,'Suneka'),(45,'Nyamache'),(45,'Keumbu'),(45,'Masimba'),(45,'Nyamarambe'),(45,'Kenyenya'),
  -- Nyamira
  (46,'Nyamira'),(46,'Keroka'),(46,'Nyansiongo'),(46,'Ikonge'),(46,'Manga'),(46,'Rigoma'),(46,'Kebirigo'),(46,'Kijauri'),
  -- Nairobi
  (47,'CBD'),(47,'Upper Hill'),(47,'Ngara'),(47,'Pangani'),(47,'Parklands'),(47,'Eastleigh'),(47,'Kariokor'),
  (47,'Westlands'),(47,'Kileleshwa'),(47,'Kilimani'),(47,'Lavington'),(47,'Kangemi'),(47,'Loresho'),(47,'Gigiri'),
  (47,'Muthaiga'),(47,'Runda'),(47,'Spring Valley'),(47,'Dagoretti'),(47,'Kawangware'),(47,'Riruta'),(47,'Satellite'),
  (47,'Waithaka'),(47,'Uthiru'),(47,'Karen'),(47,'Langata'),(47,'Nairobi West'),(47,'South C'),(47,'Otiende'),
  (47,'Kibera'),(47,'Mugumoini'),(47,'Roysambu'),(47,'Zimmerman'),(47,'Githurai 44'),(47,'Githurai 45'),
  (47,'Kahawa West'),(47,'Mwiki'),(47,'Clay City'),(47,'Ruaraka'),(47,'Donholm'),(47,'Umoja'),(47,'Kayole'),
  (47,'Komarock'),(47,'Pipeline'),(47,'Fedha'),(47,'Utawala'),(47,'Mihang’o'),(47,'Njiru'),(47,'Ruai'),
  (47,'Makadara'),(47,'Buruburu'),(47,'Jericho'),(47,'Jogoo Road'),(47,'Mathare'),(47,'Huruma'),(47,'Kariobangi'),
  (47,'Dandora'),(47,'Mukuru kwa Njenga'),(47,'Industrial Area'),(47,'South B'),(47,'Nairobi South'),
  (47,'Landmawe'),(47,'Mombasa Road')
on conflict (county_id, name) do nothing;
